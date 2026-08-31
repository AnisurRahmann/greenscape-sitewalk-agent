import { getSupabaseAdmin } from '../db/client';
import type { Database, Tables } from '../db/types';

import { embedQuery } from './embedQuery';

type FusedRpcRow = Database['public']['Functions']['match_catalog_fused']['Returns'][number];

export type CatalogItem = Tables<'catalog_items'>;

// The RPC returns the pricing-relevant columns, not the embedding/tsvector.
export type CatalogMatchItem = Pick<
  CatalogItem,
  'id' | 'sku' | 'category' | 'name' | 'description' | 'unit' | 'unit_price' | 'unit_cost' | 'min_qty' | 'notes'
>;

export type MatchMethod = 'vector' | 'lexical' | 'fuzzy' | 'hybrid' | 'unmatched';

/**
 * Below this confidence a fused candidate is treated as unmatched (flagged
 * for review rather than priced). 0.55 sits between the confidence of a
 * single-strategy rank-1 hit (1/3 — never trusted alone) and the worst
 * two-strategy agreement (~0.58 — always trusted), so the threshold demands
 * cross-strategy agreement.
 */
export const MATCH_CONFIDENCE_THRESHOLD = 0.55;

export const RRF_K = 60;
const STRATEGY_DEPTH = 10;
const DEFAULT_TOP_K = 5;

// Max possible fused score: rank 1 in all three strategies = 3 / (k + 1).
const MAX_FUSED_SCORE = 3 / (RRF_K + 1);

export interface FusedCandidate {
  catalogItem: CatalogMatchItem;
  fusedScore: number;
  /** 1-based rank within each strategy's top 10; null when not surfaced. */
  ranks: { vector: number | null; lexical: number | null; fuzzy: number | null };
  matchMethod: MatchMethod;
  /** fused_score normalised against the theoretical max, in 0..1. */
  confidence: number;
}

export interface MatchCatalogOptions {
  /** Fused candidates to return. Default 5. */
  topK?: number;
  /** Candidates below this confidence are marked 'unmatched'. */
  threshold?: number;
  /** Pre-computed query embedding (reuse across calls; skips the LLM call). */
  queryEmbedding?: number[];
  /** Provided when the query embedding should be audited to agent_runs. */
  agentRun?: { step: string; proposalId?: string | null; siteWalkId?: string | null };
}

function toCandidate(row: FusedRpcRow, threshold: number): FusedCandidate {
  const confidence = Math.min(1, row.fused_score / MAX_FUSED_SCORE);
  return {
    catalogItem: {
      id: row.id,
      sku: row.sku,
      category: row.category,
      name: row.name,
      description: row.description,
      unit: row.unit,
      unit_price: row.unit_price,
      unit_cost: row.unit_cost,
      min_qty: row.min_qty,
      notes: row.notes,
    },
    fusedScore: row.fused_score,
    ranks: { vector: row.vector_rank, lexical: row.lexical_rank, fuzzy: row.fuzzy_rank },
    matchMethod: confidence < threshold ? 'unmatched' : (row.match_method as MatchMethod),
    confidence,
  };
}

/**
 * Matches a natural-language query (spoken site-walk note fragment) against
 * the pricing catalog. Fusion happens in Postgres (match_catalog_fused);
 * this wrapper embeds the query, applies the confidence threshold, and maps
 * rows for the pricing pipeline.
 */
export async function matchCatalog(
  query: string,
  opts: MatchCatalogOptions = {},
): Promise<FusedCandidate[]> {
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const threshold = opts.threshold ?? MATCH_CONFIDENCE_THRESHOLD;

  // A pre-supplied embedding means no LLM call happens here, so none is audited.
  const embedding =
    opts.queryEmbedding ?? (await embedQuery(query, opts.agentRun));

  const { data, error } = await getSupabaseAdmin().rpc('match_catalog_fused', {
    p_query_embedding: embedding,
    p_raw_query: query,
    p_match_count: topK,
    p_rrf_k: RRF_K,
    p_strategy_depth: STRATEGY_DEPTH,
  });

  if (error) throw new Error(`match_catalog_fused failed: ${error.message}`);

  return ((data ?? []) as FusedRpcRow[]).map((row) => toCandidate(row, threshold));
}
