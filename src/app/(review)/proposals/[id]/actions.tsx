'use server';

import { renderToBuffer } from '@react-pdf/renderer';

import type { z } from 'zod';

import { getSupabaseAdmin } from '@/lib/db/client';
import { narrativeSchema } from '@/lib/agent/draftNarrative';
import { ProposalPdfDocument } from '@/lib/pdf/proposal';

export interface CommitLineEditInput {
  lineId: string;
  proposalId: string;
  field: 'quantity' | 'unit_price';
  before: number;
  after: number;
}

/** Persists a reviewed line edit and writes the before/after audit trail. */
export async function commitLineEdit(input: CommitLineEditInput): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseAdmin();

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
  return { ok: true };
}

/** Human attestation that an unverified evidence span was checked by hand. */
export async function verifyLineEvidence(
  lineId: string,
  _proposalId: string,
): Promise<{ ok: boolean; error?: string }> {
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
  /** Client totals recomputed by the real pricing engine as Marcus edited. */
  totals: {
    subtotal: number;
    mobilizationFee: number;
    contingency: number;
    tax: number;
    total: number;
    marginPct: number;
  };
}

export async function approveProposal(input: ApproveInput): Promise<{ ok: boolean; error?: string }> {
  const db = getSupabaseAdmin();
  const now = new Date().toISOString();

  const { error } = await db
    .from('proposals')
    .update({
      status: 'approved',
      approved_by: 'review-ui',
      approved_at: now,
      subtotal: input.totals.subtotal,
      mobilization_fee: input.totals.mobilizationFee,
      contingency: input.totals.contingency,
      tax: input.totals.tax,
      total: input.totals.total,
      margin_pct: input.totals.marginPct,
    })
    .eq('id', input.proposalId);
  if (error) return { ok: false, error: error.message };

  await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'proposal.approved',
    entity_type: 'proposal',
    entity_id: input.proposalId,
    after: { status: 'approved', approved_at: now, totals: input.totals },
  });
  return { ok: true };
}

export async function rejectProposal(
  proposalId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!reason.trim()) return { ok: false, error: 'A rejection reason is required.' };
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
 * Renders the branded PDF server-side (react-pdf, no client involvement),
 * uploads it to the private 'proposals' bucket and records pdf_path. Returns
 * a one-hour signed download URL for the immediate "get the file" flow.
 */
export async function generateProposalPdf(
  proposalId: string,
): Promise<GeneratePdfResult> {
  const db = getSupabaseAdmin();

  const { data: proposal, error: proposalError } = await db
    .from('proposals')
    .select('id, public_token, created_at, subtotal, mobilization_fee, contingency, tax, total, narrative, leads(full_name, phone, email, address, city)')
    .eq('id', proposalId)
    .single();
  if (proposalError || !proposal) {
    return { ok: false, error: proposalError?.message ?? 'proposal not found' };
  }

  const { data: lines, error: linesError } = await db
    .from('proposal_line_items')
    .select('description, qty, unit, unit_price, line_total, needs_review, sort_order')
    .eq('proposal_id', proposalId)
    .order('sort_order');
  if (linesError) return { ok: false, error: linesError.message };

  const pricedLines = (lines ?? []).filter((line) => !line.needs_review || line.line_total > 0);
  const optionalAddOns = (lines ?? [])
    .filter((line) => line.needs_review && line.line_total === 0)
    .map((line) => ({ description: line.description.replace(/\s*\(optional add-on\)\s*/i, ' ').trim(), quantity: line.qty, unit: line.unit }));

  let narrative: z.infer<typeof narrativeSchema> = {
    scope_overview: 'Scope of work as walked and priced.',
    whats_included: pricedLines.map((line) => line.description),
    exclusions: [],
    timeline_sentence: '',
  };
  if (proposal.narrative) {
    try {
      narrative = narrativeSchema.parse(JSON.parse(proposal.narrative));
    } catch (err) {
      console.error('stored narrative failed validation, using fallback copy:', err);
    }
  }

  const pdfData = {
    proposalId: proposal.id,
    createdAt: proposal.created_at,
    lead: {
      fullName: proposal.leads?.full_name ?? 'Valued client',
      phone: proposal.leads?.phone ?? null,
      email: proposal.leads?.email ?? null,
      address: proposal.leads?.address ?? null,
      city: proposal.leads?.city ?? null,
    },
    property: { hoaInvolved: false, permitLikely: false, accessNotes: null },
    narrative: {
      scopeOverview: narrative.scope_overview,
      timelineSentence: narrative.timeline_sentence,
      included: narrative.whats_included,
      exclusions: narrative.exclusions,
    },
    lines: pricedLines.map((line) => ({
      description: line.description,
      quantity: line.qty,
      unit: line.unit,
      unitPrice: line.unit_price,
      lineTotal: line.line_total,
    })),
    optionalAddOns,
    totals: {
      subtotal: proposal.subtotal ?? 0,
      mobilizationFee: proposal.mobilization_fee ?? 0,
      contingency: proposal.contingency ?? 0,
      tax: proposal.tax ?? 0,
      total: proposal.total ?? 0,
    },
  };

  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(<ProposalPdfDocument data={pdfData} />);
  } catch (err) {
    return { ok: false, error: `pdf render failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  const pdfPath = `${proposal.public_token}.pdf`;
  const { error: uploadError } = await db
    .storage.from('proposals')
    .upload(pdfPath, buffer, { contentType: 'application/pdf', upsert: true });
  if (uploadError) return { ok: false, error: `upload failed: ${uploadError.message}` };

  const { error: pathError } = await db
    .from('proposals')
    .update({ pdf_path: pdfPath })
    .eq('id', proposalId);
  if (pathError) return { ok: false, error: pathError.message };

  await db.from('audit_log').insert({
    actor: 'review-ui',
    action: 'proposal.pdf_generated',
    entity_type: 'proposal',
    entity_id: proposalId,
    after: { pdf_path: pdfPath, bytes: buffer.length },
  });

  const { data: signed } = await db.storage
    .from('proposals')
    .createSignedUrl(pdfPath, 3600);

  return { ok: true, pdfPath, signedUrl: signed?.signedUrl };
}
