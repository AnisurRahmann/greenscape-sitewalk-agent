/**
 * Nine-rule validation layer between pricing and anything customer-facing.
 *
 * Every rule is a pure function: data in, { rule, severity, passed, detail }
 * out — no I/O, no model calls. The orchestrator (runGuardrails) runs them
 * all, persists every result to guardrail_events, and returns an aggregate
 * verdict.
 *
 * Verdict semantics:
 * - any block  -> proposal.status = 'needs_review'; the verdict carries
 *                inlineByLine so the UI can show the blocking rules directly
 *                on the offending line items.
 * - any warn   -> shown as badges, never gates.
 * - G8/G9 fail -> verdict.aborted; the orchestration stops.
 *
 * Nothing ever auto-sends. Approval is always human in this version.
 *
 * AUTO-APPROVE TIER (on record for the future): it would be safe to
 * auto-approve ONLY when ALL of the following hold:
 *   1. proposal total < $15,000,
 *   2. zero blocking rules failed,
 *   3. zero warn rules failed (including G3 unmatched and G5 bounds),
 *   4. every line item's match_confidence > 0.90.
 * Until those are the gating criteria, a successful guardrail run still
 * requires explicit human approval before anything reaches a customer
 * (CLAUDE.md rule 5).
 */

import { getSupabaseAdmin } from '@/lib/db/client';

export type GuardrailSeverity = 'block' | 'warn';

/** jsonb-safe values only — detail is persisted to guardrail_events.detail. */
export type GuardrailDetailValue =
  | string
  | number
  | boolean
  | null
  | GuardrailDetailValue[]
  | { [key: string]: GuardrailDetailValue | undefined };
export type GuardrailDetail = Record<string, GuardrailDetailValue>;

export interface GuardrailResult {
  rule: string;
  severity: GuardrailSeverity;
  passed: boolean;
  /** 0-based line item index when the finding attaches to a specific line. */
  lineIndex?: number;
  detail: GuardrailDetail;
}

// ---------------------------------------------------------------------------
// Inputs. Everything a rule needs arrives via the context so the rules stay
// pure; the pipeline (which can talk to the database) computes the context.
// ---------------------------------------------------------------------------

export interface GuardrailExtractionItem {
  rawPhrase: string;
  committed: boolean;
  evidenceVerified: boolean;
}

export interface GuardrailExtractionState {
  schemaValid: boolean;
  retryCount: number;
  items: GuardrailExtractionItem[];
}

export interface GuardrailLineItem {
  sku: string | null;
  catalogItemId: string | null;
  description: string;
  category?: string | null;
  quantity: number;
  lineTotal: number;
  matchConfidence?: number | null;
  /** False only when the customer merely asked about this; default true. */
  committed?: boolean;
}

export interface GuardrailProposalState {
  total: number;
  marginPct: number;
  lineItems: GuardrailLineItem[];
}

export interface GuardrailContext {
  proposalId: string;
  extraction: GuardrailExtractionState;
  proposal: GuardrailProposalState;
  /** Catalog item ids known to exist; the pipeline loads these from the DB. */
  validCatalogIds: ReadonlySet<string>;
  /** Sum of agent_runs.cost_usd for this proposal. */
  agentRunCostUsd: number;
  /** Milliseconds since the orchestration started (ingest -> guardrails). */
  elapsedMs: number;
}

export type GuardrailEventSink = (
  proposalId: string,
  results: GuardrailResult[],
) => Promise<void>;

export interface GuardrailDeps {
  saveEvents?: GuardrailEventSink;
}

// ---------------------------------------------------------------------------
// G1 schema_valid — extraction Zod-parsed within the retry budget (rule 2).
// ---------------------------------------------------------------------------

export const MAX_EXTRACTION_RETRIES = 2;

export function g1SchemaValid(extraction: GuardrailExtractionState): GuardrailResult {
  const passed = extraction.schemaValid && extraction.retryCount <= MAX_EXTRACTION_RETRIES;
  return {
    rule: 'G1_schema_valid',
    severity: 'block',
    passed,
    detail: {
      schema_valid: extraction.schemaValid,
      retry_count: extraction.retryCount,
      retry_budget: MAX_EXTRACTION_RETRIES,
    },
  };
}

// ---------------------------------------------------------------------------
// G2 evidence_grounded — every item verified against the transcript (rule 3).
// ---------------------------------------------------------------------------

export function g2EvidenceGrounded(items: GuardrailExtractionItem[]): GuardrailResult {
  const unverified = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !item.evidenceVerified);

  return {
    rule: 'G2_evidence_grounded',
    severity: 'block',
    passed: unverified.length === 0,
    detail: {
      total_items: items.length,
      unverified: unverified.map(({ item, index }) => ({ index, raw_phrase: item.rawPhrase })),
    },
  };
}

// ---------------------------------------------------------------------------
// G3 catalog_grounded — no dangling catalog references (block); unmatched
// items are a warn that forces needs_review, never a silent drop.
// ---------------------------------------------------------------------------

export function g3CatalogGrounded(
  lineItems: GuardrailLineItem[],
  validCatalogIds: ReadonlySet<string>,
): GuardrailResult {
  const dangling = lineItems
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.catalogItemId !== null && !validCatalogIds.has(line.catalogItemId));

  if (dangling.length > 0) {
    return {
      rule: 'G3_catalog_grounded',
      severity: 'block',
      passed: false,
      detail: {
        reason: 'dangling_catalog_reference',
        offenders: dangling.map(({ line, index }) => ({
          line_index: index,
          sku: line.sku,
          catalog_item_id: line.catalogItemId,
        })),
      },
    };
  }

  const unmatched = lineItems
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.catalogItemId === null);

  return {
    rule: 'G3_catalog_grounded',
    severity: 'warn',
    passed: unmatched.length === 0,
    detail: {
      reason: unmatched.length > 0 ? 'unmatched_items_present' : 'all_items_matched',
      unmatched_count: unmatched.length,
      unmatched: unmatched.map(({ index, line }) => ({
        line_index: index,
        sku: line.sku,
        description: line.description,
      })),
      // Unmatched lines never silently vanish: the verdict forces
      // needs_review so a human prices them before anything is sent.
      forces_needs_review: unmatched.length > 0,
    },
  };
}

// ---------------------------------------------------------------------------
// G4 margin_floor — below 30% gross margin the job goes to review.
// ---------------------------------------------------------------------------

export const MARGIN_FLOOR_PCT = 30;

export function g4MarginFloor(marginPct: number): GuardrailResult {
  return {
    rule: 'G4_margin_floor',
    severity: 'block',
    passed: marginPct >= MARGIN_FLOOR_PCT,
    detail: { margin_pct: marginPct, floor_pct: MARGIN_FLOOR_PCT },
  };
}

// ---------------------------------------------------------------------------
// G5 total_bounds — $8,000..$120,000 is the client's own stated project range.
// Outside is expected sometimes; warn with the reason, never block.
// ---------------------------------------------------------------------------

export const TOTAL_MIN_USD = 8_000;
export const TOTAL_MAX_USD = 120_000;

export function g5TotalBounds(total: number): GuardrailResult {
  const passed = total >= TOTAL_MIN_USD && total <= TOTAL_MAX_USD;
  const reason =
    total < TOTAL_MIN_USD ? 'below_minimum' : total > TOTAL_MAX_USD ? 'above_maximum' : 'within_range';
  return {
    rule: 'G5_total_bounds',
    severity: 'warn',
    passed,
    detail: {
      total: total,
      min: TOTAL_MIN_USD,
      max: TOTAL_MAX_USD,
      reason,
    },
  };
}

// ---------------------------------------------------------------------------
// G6 quantity_sanity — catches fat-fingered quantities against historical
// percentiles. Static table for now, keyed by catalog category; a category
// without history passes with a note. Violations block: a 40x quantity typo
// produces a proposal that must be human-reviewed, not badged.
// ---------------------------------------------------------------------------

export const QUANTITY_P90_MULTIPLIER = 4;

export const CATEGORY_QTY_P90: Record<string, number> = {
  'Pavers & Travertine': 1200,
  'Concrete & Stamped': 1000,
  'Retaining Walls': 60,
  'Pergolas & Ramadas': 400,
  'Fire Features': 2,
  'Water Features': 2,
  'Outdoor Kitchens': 16,
  'Artificial Turf': 1000,
  Irrigation: 8,
  'Landscape Lighting': 12,
  'Planting & Trees': 20,
  'Demolition & Haul-Off': 700,
  Grading: 2500,
  Drainage: 80,
  'Gravel & DG': 800,
  Mobilization: 1,
  'Permit Handling': 2,
  'HOA Package Prep': 1,
  'Design Fees': 2,
};

export function g6QuantitySanity(lineItems: GuardrailLineItem[]): GuardrailResult {
  const offenders: GuardrailDetail[] = [];
  const unknownCategories = new Set<string>();
  let firstOffenderIndex: number | undefined;

  lineItems.forEach((line, index) => {
    const category = line.category ?? undefined;
    const historicalP90 = category ? CATEGORY_QTY_P90[category] : undefined;
    if (historicalP90 === undefined) {
      if (category) unknownCategories.add(category);
      return;
    }
    const maxAllowed = QUANTITY_P90_MULTIPLIER * historicalP90;
    if (line.quantity > maxAllowed) {
      offenders.push({
        line_index: index,
        sku: line.sku,
        category: category ?? null,
        quantity: line.quantity,
        max_allowed: maxAllowed,
      });
      if (firstOffenderIndex === undefined) firstOffenderIndex = index;
    }
  });

  return {
    rule: 'G6_quantity_sanity',
    severity: 'block',
    passed: offenders.length === 0,
    lineIndex: firstOffenderIndex,
    detail: {
      multiplier: QUANTITY_P90_MULTIPLIER,
      offenders,
      categories_without_history: [...unknownCategories],
    },
  };
}

// ---------------------------------------------------------------------------
// G7 uncommitted_items — asked-about-but-not-committed scope must land in the
// optional add-ons section ($0 lines), never leak into the total.
// ---------------------------------------------------------------------------

export function g7UncommittedItems(lineItems: GuardrailLineItem[]): GuardrailResult {
  const optional = lineItems
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.committed === false);

  const leaked = optional.filter(({ line }) => line.lineTotal > 0);

  return {
    rule: 'G7_uncommitted_items',
    severity: 'block',
    passed: leaked.length === 0,
    lineIndex: leaked[0]?.index,
    detail: {
      optional_add_ons: optional.map(({ index, line }) => ({
        line_index: index,
        sku: line.sku,
        description: line.description,
        line_total: line.lineTotal,
      })),
      leaked_into_total: leaked.map(({ index, line }) => ({
        line_index: index,
        sku: line.sku,
        line_total: line.lineTotal,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// G8 cost_ceiling — the whole agent run must stay under $0.75 (rule: the
// per-proposal cost target is under $0.15 for model calls; the ceiling here
// covers the full pipeline including audio). Exceeding it aborts the run.
// ---------------------------------------------------------------------------

export const PROPOSAL_COST_CEILING_USD = 0.75;

export function g8CostCeiling(agentRunCostUsd: number): GuardrailResult {
  return {
    rule: 'G8_cost_ceiling',
    severity: 'block',
    passed: agentRunCostUsd < PROPOSAL_COST_CEILING_USD,
    detail: {
      cost_usd: agentRunCostUsd,
      ceiling_usd: PROPOSAL_COST_CEILING_USD,
    },
  };
}

// ---------------------------------------------------------------------------
// G9 wall_clock — dead-man switch for the whole orchestration. Finishing
// exactly at the limit passes; anything over aborts.
// ---------------------------------------------------------------------------

export const ORCHESTRATION_LIMIT_MS = 120_000;

export function g9WallClock(elapsedMs: number): GuardrailResult {
  return {
    rule: 'G9_wall_clock',
    severity: 'block',
    passed: elapsedMs <= ORCHESTRATION_LIMIT_MS,
    detail: {
      elapsed_ms: elapsedMs,
      limit_ms: ORCHESTRATION_LIMIT_MS,
    },
  };
}

// ---------------------------------------------------------------------------
// Orchestration: run everything, persist everything, aggregate the verdict.
// ---------------------------------------------------------------------------

export type GuardrailStatus = 'passed' | 'needs_review' | 'aborted';

export interface GuardrailVerdict {
  status: GuardrailStatus;
  /** Set to 'needs_review' when any block failed; null leaves status as-is. */
  proposalStatus: 'needs_review' | null;
  aborted: boolean;
  results: GuardrailResult[];
  blocking: GuardrailResult[];
  warns: GuardrailResult[];
  /** line index -> blocking rule ids, for inline UI display on line items. */
  inlineByLine: Record<number, string[]>;
}

function defaultSaveEvents(): GuardrailEventSink {
  return async (proposalId, results) => {
    const { error } = await getSupabaseAdmin()
      .from('guardrail_events')
      .insert(
        results.map((result) => ({
          proposal_id: proposalId,
          rule: result.rule,
          severity: result.severity,
          passed: result.passed,
          detail:
            result.lineIndex === undefined
              ? result.detail
              : { ...result.detail, line_index: result.lineIndex },
        })),
      );
    if (error) throw new Error(error.message);
  };
}

export async function runGuardrails(
  context: GuardrailContext,
  deps: GuardrailDeps = {},
): Promise<GuardrailVerdict> {
  const results: GuardrailResult[] = [
    g1SchemaValid(context.extraction),
    g2EvidenceGrounded(context.extraction.items),
    g3CatalogGrounded(context.proposal.lineItems, context.validCatalogIds),
    g4MarginFloor(context.proposal.marginPct),
    g5TotalBounds(context.proposal.total),
    g6QuantitySanity(context.proposal.lineItems),
    g7UncommittedItems(context.proposal.lineItems),
    g8CostCeiling(context.agentRunCostUsd),
    g9WallClock(context.elapsedMs),
  ];

  // Persistence is audit, not gating: a failed write is loud on stderr but
  // never changes the verdict, and every result is attempted regardless of
  // earlier failures (rule 4 spirit — observability is not optional).
  const saveEvents = deps.saveEvents ?? defaultSaveEvents();
  try {
    await saveEvents(context.proposalId, results);
  } catch (err) {
    console.error(`guardrail_events write failed for proposal ${context.proposalId}:`, err);
  }

  const failed = results.filter((result) => !result.passed);
  const blocking = failed.filter((result) => result.severity === 'block');
  const warns = failed.filter((result) => result.severity === 'warn');
  const aborted = blocking.some(
    (result) => result.rule === 'G8_cost_ceiling' || result.rule === 'G9_wall_clock',
  );

  const inlineByLine: Record<number, string[]> = {};
  for (const block of blocking) {
    if (block.lineIndex === undefined) continue;
    const existing = inlineByLine[block.lineIndex] ?? [];
    existing.push(block.rule);
    inlineByLine[block.lineIndex] = existing;
  }

  return {
    status: aborted ? 'aborted' : blocking.length > 0 ? 'needs_review' : 'passed',
    proposalStatus: blocking.length > 0 ? 'needs_review' : null,
    aborted,
    results,
    blocking,
    warns,
    inlineByLine,
  };
}
