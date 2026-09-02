'use server';

import { after } from 'next/server';

import { requireSession } from '@/lib/auth/require-session';
import { getSupabaseAdmin } from '@/lib/db/client';
import { dispatchProposal } from '@/lib/dispatch';
import { ensureProposalPdf } from '@/lib/dispatch/proposal-pdf';
import { recordCorrection } from '@/lib/review/corrections';
import { stripUnmatchedMarker } from '@/lib/pricing/engine';
import {
  repriceStoredProposal,
  ApprovalBlockedError,
} from '@/lib/review/reprice-proposal';

export interface CommitLineEditInput {
  lineId: string;
  proposalId: string;
  field: 'quantity' | 'unit_price';
  before: number;
  after: number;
}

/** Persists a reviewed line edit and writes the before/after audit trail. */
export async function commitLineEdit(input: CommitLineEditInput): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const db = getSupabaseAdmin();

  // The correction needs the line's retrieval context (what the machine
  // heard and how confident it was) — read before the edit lands.
  const { data: line } = await db
    .from('proposal_line_items')
    .select('transcript_evidence, match_confidence')
    .eq('id', input.lineId)
    .single();

  // Computed keys widen to `never` under the generated row types — branch instead.
  const { error: updateError } =
    input.field === 'quantity'
      ? await db
          .from('proposal_line_items')
          .update({ qty: input.after })
          .eq('id', input.lineId)
      : await db
          .from('proposal_line_items')
          .update({ unit_price: input.after })
          .eq('id', input.lineId);
  if (updateError) return { ok: false, error: updateError.message };

  const { error: auditError } = await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'line_item.update',
    entity_type: 'proposal_line_item',
    entity_id: input.lineId,
    before: { [input.field]: input.before },
    after: { [input.field]: input.after },
  });
  if (auditError) {
    // The edit itself persisted; a broken audit trail must be loud.
    console.error('audit_log write failed for line edit:', auditError);
  }

  await recordCorrection(db, {
    proposalId: input.proposalId,
    lineItemId: input.lineId,
    correctionType: input.field === 'quantity' ? 'qty' : 'price',
    before: { [input.field]: input.before },
    after: { [input.field]: input.after },
    originalQuery: line?.transcript_evidence ?? null,
    matchConfidenceAtTime: line?.match_confidence ?? null,
  });
  return { ok: true };
}

export interface ManualPriceInput {
  proposalId: string;
  lineId: string;
  unitPrice: number;
  unitCost: number;
  /** The reviewer's own description; defaults to the stored normalized query. */
  description?: string;
}

/**
 * The manual-price escape hatch: prices an unmatched line by hand. A price
 * above zero flips the line to match_method='manual' (G3 stops blocking) and
 * requires a unit cost — without one the line silently contributes zero cost
 * and the margin floor is meaningless. A price of zero reverts the line to
 * 'unmatched'. Both directions write audit + corrections rows.
 */
export async function setManualPrice(
  input: ManualPriceInput,
): Promise<{ ok: boolean; error?: string; description?: string }> {
  await requireSession();
  const db = getSupabaseAdmin();

  const price = Number(input.unitPrice) || 0;
  const cost = Number(input.unitCost) || 0;
  if (price < 0 || cost < 0) return { ok: false, error: 'Price and cost must be non-negative.' };
  if (price > 0 && cost <= 0) {
    return { ok: false, error: 'A unit cost is required to price a line manually.' };
  }

  const { data: line, error: lineError } = await db
    .from('proposal_line_items')
    .select('description, qty, match_method, match_confidence, transcript_evidence')
    .eq('id', input.lineId)
    .eq('proposal_id', input.proposalId)
    .single();
  if (lineError || !line) return { ok: false, error: lineError?.message ?? 'line not found' };

  const manual = price > 0;
  // The reviewer's own text wins; otherwise keep the stored normalized query
  // with the reviewer-only marker stripped — the marker must never reach the
  // PDF or /p/[token], and this line is about to become customer-visible.
  const description =
    input.description?.trim() || stripUnmatchedMarker(line.description) || line.description;

  const update = manual
    ? {
        unit_price: price,
        unit_cost: cost,
        match_method: 'manual',
        needs_review: false,
        description,
      }
    : {
        unit_price: 0,
        unit_cost: 0,
        match_method: 'unmatched',
        needs_review: true,
        description,
      };

  const { error: updateError } = await db
    .from('proposal_line_items')
    .update(update)
    .eq('id', input.lineId)
    .eq('proposal_id', input.proposalId);
  if (updateError) return { ok: false, error: updateError.message };

  await db.from('audit_log').insert({
    actor: 'review-ui',
    action: manual ? 'line_item.manual_price' : 'line_item.manual_price_cleared',
    entity_type: 'proposal_line_item',
    entity_id: input.lineId,
    before: { match_method: line.match_method, description: line.description },
    after: update,
  });

  await recordCorrection(db, {
    proposalId: input.proposalId,
    lineItemId: input.lineId,
    correctionType: manual ? 'add' : 'remove',
    before: { match_method: line.match_method, description: line.description },
    after: update,
    originalQuery: line.transcript_evidence,
    matchConfidenceAtTime: line.match_confidence,
  });

  return { ok: true, description };
}

export interface ExcludeLineInput {
  proposalId: string;
  lineId: string;
  reason: string;
}

/** Soft-deletes a reviewed line. A short reason is required; the line stays
 *  visible in review (struck through) but never prices or renders to the
 *  customer. */
export async function excludeProposalLine(
  input: ExcludeLineInput,
): Promise<{ ok: boolean; error?: string }> {
  const reason = input.reason.trim();
  if (!reason) return { ok: false, error: 'A removal reason is required.' };
  await requireSession();
  const db = getSupabaseAdmin();

  const { data: line } = await db
    .from('proposal_line_items')
    .select('description, qty, unit_price, line_total, transcript_evidence, match_confidence')
    .eq('id', input.lineId)
    .eq('proposal_id', input.proposalId)
    .single();

  const { error: updateError } = await db
    .from('proposal_line_items')
    .update({ excluded: true, excluded_reason: reason })
    .eq('id', input.lineId)
    .eq('proposal_id', input.proposalId);
  if (updateError) return { ok: false, error: updateError.message };

  const { error: auditError } = await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'line_item.excluded',
    entity_type: 'proposal_line_item',
    entity_id: input.lineId,
    before: { excluded: false },
    after: { excluded: true, reason },
  });
  if (auditError) {
    console.error('audit_log write failed for line exclusion:', auditError);
  }

  await recordCorrection(db, {
    proposalId: input.proposalId,
    lineItemId: input.lineId,
    correctionType: 'remove',
    before: {
      description: line?.description ?? null,
      qty: line?.qty ?? null,
      unit_price: line?.unit_price ?? null,
      line_total: line?.line_total ?? null,
    },
    after: { excluded: true, reason },
    originalQuery: line?.transcript_evidence ?? null,
    matchConfidenceAtTime: line?.match_confidence ?? null,
  });
  return { ok: true };
}

/** Human attestation that an unverified evidence span was checked by hand. */
export async function verifyLineEvidence(
  lineId: string,
  _proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from('proposal_line_items')
    .update({ evidence_verified: true })
    .eq('id', lineId);
  if (error) return { ok: false, error: error.message };

  await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'line_item.evidence_verified',
    entity_type: 'proposal_line_item',
    entity_id: lineId,
    after: { evidence_verified: true },
  });
  return { ok: true };
}

export interface ApproveInput {
  proposalId: string;
}

/**
 * Approval is server-authoritative (CLAUDE.md rule 1): line edits have
 * already been persisted by commitLineEdit, so this reprices the proposal
 * from the database, refuses on any blocking rule, and persists only what
 * the engine computed here. A totals payload sent by a client is ignored.
 */
export async function approveProposal(input: ApproveInput): Promise<{ ok: boolean; error?: string }> {
  await requireSession();
  const db = getSupabaseAdmin();

  const repriced = await repriceStoredProposal(db, input.proposalId);
  if (!repriced) return { ok: false, error: 'proposal not found' };

  const blockedBy = repriced.results
    .filter((result) => !result.passed && result.severity === 'block')
    .map((result) => result.rule);
  if (blockedBy.length > 0) throw new ApprovalBlockedError(blockedBy);

  const { priced } = repriced;
  const now = new Date().toISOString();

  const { error } = await db
    .from('proposals')
    .update({
      status: 'approved',
      approved_by: 'review-ui',
      approved_at: now,
      subtotal: priced.subtotal,
      mobilization_fee: priced.mobilizationFee,
      contingency: priced.contingency,
      tax: priced.tax,
      total: priced.total,
      margin_pct: priced.marginPct,
    })
    .eq('id', input.proposalId);
  if (error) return { ok: false, error: error.message };

  await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'proposal.approved',
    entity_type: 'proposal',
    entity_id: input.proposalId,
    after: {
      status: 'approved',
      approved_at: now,
      totals_source: 'server_repriced',
      totals: {
        subtotal: priced.subtotal,
        mobilizationFee: priced.mobilizationFee,
        contingency: priced.contingency,
        tax: priced.tax,
        total: priced.total,
        marginPct: priced.marginPct,
      },
    },
  });

  // Fan out email/sms/slack/stripe/ghl after the response — idempotency keys
  // make a repeated trigger safe, and the response never waits on providers.
  after(async () => {
    const summary = await dispatchProposal(input.proposalId).catch((err: unknown) => {
      console.error(`dispatch failed for ${input.proposalId}:`, err);
      return null;
    });
    if (summary) {
      console.log(
        'dispatch summary:',
        summary.channels.map((c) => `${c.channel}=${c.status}`).join(' '),
      );
    }
  });

  return { ok: true };
}

export async function rejectProposal(
  proposalId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!reason.trim()) return { ok: false, error: 'A rejection reason is required.' };
  await requireSession();
  const db = getSupabaseAdmin();

  const { error } = await db
    .from('proposals')
    .update({ status: 'rejected' })
    .eq('id', proposalId);
  if (error) return { ok: false, error: error.message };

  await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'proposal.rejected',
    entity_type: 'proposal',
    entity_id: proposalId,
    after: { status: 'rejected', reason },
  });
  return { ok: true };
}


export interface GeneratePdfResult {
  ok: boolean;
  error?: string;
  pdfPath?: string;
  signedUrl?: string;
}

/**
 * Rendering/upload lives in src/lib/dispatch/proposal-pdf.ts so the dispatch
 * email channel shares the exact same render path.
 */
export async function generateProposalPdf(
  proposalId: string,
): Promise<GeneratePdfResult> {
  await requireSession();
  const db = getSupabaseAdmin();

  let pdfPath: string;
  let bytes: number;
  try {
    const ensured = await ensureProposalPdf(proposalId);
    pdfPath = ensured.pdfPath;
    bytes = Buffer.from(ensured.base64, 'base64').length;
  } catch (err) {
    return { ok: false, error: `pdf render failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'proposal.pdf_generated',
    entity_type: 'proposal',
    entity_id: proposalId,
    after: { pdf_path: pdfPath, bytes },
  });

  const { data: signed } = await db.storage
    .from('proposals')
    .createSignedUrl(pdfPath, 3600);

  return { ok: true, pdfPath, signedUrl: signed?.signedUrl };
}
