import { renderToBuffer } from '@react-pdf/renderer';

import { narrativeSchema } from '@/lib/agent/draftNarrative';
import { getSupabaseAdmin } from '@/lib/db/client';
import { effectiveUnitPrice } from '@/lib/pricing/engine';
import { ProposalPdfDocument } from '@/lib/pdf/proposal';

export interface EnsurePdfResult {
  pdfPath: string;
  base64: string;
}

/**
 * Returns the proposal's stored PDF, rendering and uploading it on first
 * use. Shared by the review "Generate PDF" action and the dispatch email
 * attachment so there is exactly one render path.
 */
export async function ensureProposalPdf(proposalId: string): Promise<EnsurePdfResult> {
  const db = getSupabaseAdmin();

  const { data: proposal, error: proposalError } = await db
    .from('proposals')
    .select(
      'id, public_token, created_at, pdf_path, subtotal, mobilization_fee, contingency, tax, total, narrative, leads(full_name, phone, email, address, city)',
    )
    .eq('id', proposalId)
    .single();
  if (proposalError || !proposal) {
    throw new Error(proposalError?.message ?? 'proposal not found');
  }

  if (proposal.pdf_path) {
    const { data: stored } = await db.storage.from('proposals').download(proposal.pdf_path);
    if (stored) {
      return {
        pdfPath: proposal.pdf_path,
        base64: Buffer.from(await stored.arrayBuffer()).toString('base64'),
      };
    }
  }

  const { data: lines, error: linesError } = await db
    .from('proposal_line_items')
    .select('description, qty, unit, unit_price, discount_bps, line_total, needs_review, sort_order')
    .eq('proposal_id', proposalId)
    .order('sort_order');
  if (linesError) throw new Error(linesError.message);

  const pricedLines = (lines ?? []).filter((line) => !line.needs_review || line.line_total > 0);
  const optionalAddOns = (lines ?? [])
    .filter((line) => line.needs_review && line.line_total === 0)
    .map((line) => ({
      description: line.description.replace(/\s*\(optional add-on\)\s*/i, ' ').trim(),
      quantity: line.qty,
      unit: line.unit,
    }));

  const narrative = proposal.narrative
    ? narrativeSchema.parse(JSON.parse(proposal.narrative))
    : {
        scope_overview: 'Scope of work as walked and priced.',
        whats_included: pricedLines.map((line) => line.description),
        exclusions: [],
        timeline_sentence: '',
      };

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
      unitPrice: effectiveUnitPrice(line.unit_price, line.discount_bps),
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

  const buffer = await renderToBuffer(<ProposalPdfDocument data={pdfData} />);

  const pdfPath = `${proposal.public_token}.pdf`;
  const { error: uploadError } = await db
    .storage.from('proposals')
    .upload(pdfPath, buffer, { contentType: 'application/pdf', upsert: true });
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

  const { error: pathError } = await db
    .from('proposals')
    .update({ pdf_path: pdfPath })
    .eq('id', proposalId);
  if (pathError) throw new Error(pathError.message);

  return { pdfPath, base64: buffer.toString('base64') };
}
