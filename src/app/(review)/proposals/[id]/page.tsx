import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProposalReview } from '@/components/review/proposal-review';
import { getSupabaseAdmin } from '@/lib/db/client';

export const metadata: Metadata = { title: 'Review proposal — Greenscape Pro' };

export const dynamic = 'force-dynamic';

// Covers the approve/reject actions and their after() dispatch fan-out.
export const maxDuration = 120;

export default async function ProposalReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const db = getSupabaseAdmin();

  const { data: proposal } = await db
    .from('proposals')
    .select('id, status, lead_id, site_walk_id, narrative, leads(full_name)')
    .eq('id', id)
    .single();
  if (!proposal) notFound();

  const { data: lines } = await db
    .from('proposal_line_items')
    .select('*')
    .eq('proposal_id', id)
    .order('sort_order');

  // The client reprices with the real engine, which needs each line's
  // catalog min_qty and materials_ratio — loaded here, once.
  const catalogIds = (lines ?? [])
    .map((line) => line.catalog_item_id)
    .filter((value): value is string => value !== null);
  const { data: catalogRows } = catalogIds.length
    ? await db.from('catalog_items').select('id, category, min_qty, materials_ratio').in('id', catalogIds)
    : { data: [] };
  const catalogById = new Map((catalogRows ?? []).map((row) => [row.id, row]));

  const { data: events } = await db
    .from('guardrail_events')
    .select('rule, severity, passed, detail')
    .eq('proposal_id', id);

  const g9 = (events ?? []).find((event) => event.rule === 'G9_wall_clock');
  const elapsedMs =
    g9?.detail && typeof g9.detail === 'object' && 'elapsed_ms' in g9.detail
      ? Number((g9.detail as { elapsed_ms: number }).elapsed_ms)
      : null;

  const { data: costRows } = await db
    .from('agent_runs')
    .select('cost_usd')
    .eq('proposal_id', id);
  const generationCostUsd = (costRows ?? []).reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);

  const { data: walk } = await db
    .from('site_walks')
    .select('transcript')
    .eq('id', proposal.site_walk_id)
    .single();

  // The catalog ids that actually exist — G3 needs this set client-side.
  const validCatalogIds = (catalogRows ?? []).map((row) => row.id);

  const reviewLines = (lines ?? []).map((line) => {
    const catalog = line.catalog_item_id ? catalogById.get(line.catalog_item_id) : undefined;
    return {
      id: line.id,
      catalogItemId: line.catalog_item_id,
      // Snapshot written at persist time — a live catalog join could change
      // under the proposal, this cannot.
      sku: line.sku,
      description: line.description,
      category: catalog?.category ?? null,
      quantity: line.qty,
      unit: line.unit,
      unitPrice: line.unit_price,
      discountBps: line.discount_bps,
      unitCost: line.unit_cost,
      lineTotal: line.line_total,
      matchMethod: line.match_method ?? 'manual',
      matchConfidence: line.match_confidence,
      transcriptEvidence: line.transcript_evidence,
      evidenceVerified: line.evidence_verified,
      needsReview: line.needs_review,
      minQty: catalog?.min_qty ?? 0,
      materialsRatio: catalog?.materials_ratio ?? 0.45,
      isOptionalAddOn: line.description.includes('(optional add-on)'),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <Link href="/proposals" className="text-sm text-muted-foreground hover:text-foreground">
        ← All proposals
      </Link>
      <ProposalReview
        proposalId={proposal.id}
        leadName={proposal.leads?.full_name ?? 'Unknown lead'}
        status={proposal.status}
        lines={reviewLines}
        validCatalogIds={validCatalogIds}
        generationCostUsd={generationCostUsd}
        elapsedMs={elapsedMs}
        transcript={walk?.transcript ?? ''}
      />
    </div>
  );
}
