import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/db/types';
import {
  evaluateRules,
  ORCHESTRATION_LIMIT_MS,
  type GuardrailLineItem,
  type GuardrailResult,
} from '@/lib/guardrails/rules';
import { priceProposal, type MatchedItemInput, type PricedProposal } from '@/lib/pricing/engine';

export interface RepricedProposal {
  priced: PricedProposal;
  results: GuardrailResult[];
}

/** Thrown when the server-side reprice hits a blocking rule: the approval is
 *  refused before anything is persisted, and dispatch never fans out. */
export class ApprovalBlockedError extends Error {
  readonly blockedBy: string[];
  constructor(blockedBy: string[]) {
    super(`approval blocked by: ${blockedBy.join(', ')}`);
    this.name = 'ApprovalBlockedError';
    this.blockedBy = blockedBy;
  }
}

/**
 * The server's own view of a proposal: reload the stored line items, re-run
 * the real pricing engine, re-run every guardrail rule. Approval trusts this
 * and nothing else — a client's live totals are advisory at best and hostile
 * at worst (CLAUDE.md rule 1: only the server computes a total).
 *
 * Returns null when the proposal has no stored line items to reprice from.
 */
export async function repriceStoredProposal(
  db: SupabaseClient<Database>,
  proposalId: string,
): Promise<RepricedProposal | null> {
  const { data: lines, error } = await db
    .from('proposal_line_items')
    .select('*')
    .eq('proposal_id', proposalId)
    .order('sort_order');
  if (error) throw new Error(error.message);
  if (!lines || lines.length === 0) return null;

  // Same hydration as the review page: the engine needs each line's catalog
  // category (volume tiers), min_qty and materials_ratio.
  const catalogIds = lines
    .map((line) => line.catalog_item_id)
    .filter((value): value is string => value !== null);
  const { data: catalogRows } = catalogIds.length
    ? await db
        .from('catalog_items')
        .select('id, category, min_qty, materials_ratio')
        .in('id', catalogIds)
    : { data: [] };
  const catalogById = new Map((catalogRows ?? []).map((row) => [row.id, row]));

  const isOptionalAddOn = (description: string): boolean =>
    description.includes('(optional add-on)');

  const mainInputs: MatchedItemInput[] = lines
    .filter((line) => !isOptionalAddOn(line.description))
    .map((line) => {
      const catalog = line.catalog_item_id ? catalogById.get(line.catalog_item_id) : undefined;
      return {
        catalogItemId: line.catalog_item_id,
        description: line.description,
        category: catalog?.category ?? null,
        quantity: line.qty,
        unit: line.unit,
        unitPrice: line.unit_price,
        unitCost: line.unit_cost,
        minQty: catalog?.min_qty ?? 0,
        materialsRatio: catalog?.materials_ratio ?? 0.45,
        matchMethod: line.match_method ?? 'manual',
        matchConfidence: line.match_confidence,
        transcriptEvidence: line.transcript_evidence,
        evidenceVerified: line.evidence_verified,
      };
    });

  const priced = priceProposal(mainInputs);

  const guardrailLines: GuardrailLineItem[] = priced.lineItems.map((line) => ({
    sku: line.sku,
    catalogItemId: line.catalogItemId,
    description: line.description,
    category: line.category,
    quantity: line.quantity,
    lineTotal: line.lineTotal,
    matchConfidence: line.matchConfidence,
    committed: true,
  }));
  // Optional add-ons stay at their stored $0 and feed only G7 (nothing
  // leaked into the total) — the pipeline never priced them either.
  for (const line of lines.filter((line) => isOptionalAddOn(line.description))) {
    const catalog = line.catalog_item_id ? catalogById.get(line.catalog_item_id) : undefined;
    guardrailLines.push({
      sku: null,
      catalogItemId: line.catalog_item_id,
      description: line.description,
      category: catalog?.category ?? null,
      quantity: line.qty,
      lineTotal: line.line_total,
      matchConfidence: line.match_confidence,
      committed: false,
    });
  }

  const referencedIds = guardrailLines
    .map((line) => line.catalogItemId)
    .filter((value): value is string => value !== null);
  const { data: existing } = referencedIds.length
    ? await db.from('catalog_items').select('id').in('id', referencedIds)
    : { data: [] };
  const validCatalogIds = new Set((existing ?? []).map((row) => row.id));

  const { data: costRows } = await db
    .from('agent_runs')
    .select('cost_usd')
    .eq('proposal_id', proposalId);
  const agentRunCostUsd = (costRows ?? []).reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);

  // G9 measures the pipeline's wall clock, recorded when the pipeline ran its
  // guardrails — not the (much later) approval click.
  const { data: events } = await db
    .from('guardrail_events')
    .select('rule, detail')
    .eq('proposal_id', proposalId);
  const g9 = (events ?? []).find((event) => event.rule === 'G9_wall_clock');
  const elapsedMs =
    g9?.detail && typeof g9.detail === 'object' && 'elapsed_ms' in g9.detail
      ? Number((g9.detail as { elapsed_ms: number }).elapsed_ms)
      : ORCHESTRATION_LIMIT_MS;

  const results = evaluateRules({
    proposalId,
    extraction: {
      schemaValid: true,
      retryCount: 0,
      items: lines
        .filter((line) => !isOptionalAddOn(line.description))
        .map((line) => ({
          rawPhrase: line.transcript_evidence ?? line.description,
          committed: true,
          evidenceVerified: line.evidence_verified,
        })),
    },
    proposal: {
      total: priced.total,
      marginPct: priced.marginPct,
      lineItems: guardrailLines,
    },
    validCatalogIds,
    agentRunCostUsd,
    elapsedMs,
  });

  return { priced, results };
}
