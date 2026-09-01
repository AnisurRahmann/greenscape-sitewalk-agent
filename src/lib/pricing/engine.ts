/**
 * Deterministic pricing engine. Zero LLM involvement in this file — that is
 * the point (CLAUDE.md rule 1): the model maps words to catalog items, this
 * module turns matched items into a priced proposal. Same input, same output,
 * every time.
 *
 * All arithmetic runs in integer cents (see ./money); float dollars exist only
 * at the boundaries (catalog values in, proposal values out).
 *
 * Re-pricing is idempotent: unitPrice stays the catalog LIST price and the
 * applied volume tier is recorded separately (discountBps), so running the
 * engine over its own priced output — or over stored line items — applies the
 * tier exactly once.
 */

import { centsTimesBps, centsTimesRatio, fromCents, toCents } from './money';

// Phoenix, AZ combined sales tax rate: 8.6% on the materials portion only.
export const PHOENIX_TAX_RATE_BPS = 860;
const CONTINGENCY_BPS = 500; // 5% of subtotal, itemised and visible
export const MOBILIZATION_FEE_CENTS = 85_000; // flat $850
// Strictly greater: a subtotal of exactly $40,000 still pays mobilization.
const MOBILIZATION_WAIVER_SUBTOTAL_CENTS = 4_000_000;
const DEFAULT_MATERIALS_RATIO = 0.45;

// Volume tiers: sqft lines in these categories earn a unit discount past the
// thresholds. "over" is strict — exactly 800/1500 sqft earns the lower tier.
const VOLUME_TIER_CATEGORY = /paver|travertine|turf/i;
const TIER_1_DISCOUNT_BPS = 400; // 4% off unit price over 800 sqft
const TIER_2_DISCOUNT_BPS = 700; // 7% off unit price over 1500 sqft
const TIER_1_MIN_SQFT = 800;
const TIER_2_MIN_SQFT = 1500;

export interface MatchedItemInput {
  catalogItemId?: string | null;
  sku?: string | null;
  /** Catalog display name at match time — snapshotted so later catalog
   *  edits cannot rewrite a stored proposal. Null for unmatched lines. */
  catalogName?: string | null;
  /** What the contractor/customer actually said, or the human-typed line. */
  description: string;
  category?: string | null;
  quantity?: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  unitCost?: number | null;
  minQty?: number | null;
  materialsRatio?: number | null;
  matchMethod?: string | null;
  matchConfidence?: number | null;
  transcriptEvidence?: string | null;
  evidenceVerified?: boolean;
}

export interface PricingContext {
  /** Override for testing/other jurisdictions; basis points (8.6% -> 860). */
  taxRateBps?: number;
}

export interface PricedLineItem {
  catalogItemId: string | null;
  sku: string | null;
  /** Catalog name at match time — the snapshot that keeps stored proposals
   *  reproducible. Null for unmatched lines. */
  catalogName: string | null;
  description: string;
  category: string | null;
  quantity: number;
  unit: string;
  /** Catalog list price — NOT the discounted price. Persisting this is what
   *  makes re-pricing stored line items idempotent. */
  unitPrice: number;
  /** Volume tier actually applied to this line (0 when none). */
  discountBps: number;
  /** unitPrice after discountBps — what the line bills per unit. */
  effectiveUnitPrice: number;
  unitCost: number;
  lineTotal: number;
  /** Carried through so a priced line is itself a valid engine input. */
  minQty: number | null;
  materialsRatio: number | null;
  matchMethod: string;
  matchConfidence: number | null;
  transcriptEvidence: string | null;
  evidenceVerified: boolean;
  needsReview: boolean;
  sortOrder: number;
}

export interface PricedProposal {
  lineItems: PricedLineItem[];
  subtotal: number;
  mobilizationFee: number;
  contingency: number;
  tax: number;
  total: number;
  costTotal: number;
  /** Gross margin as a percent of total, e.g. 38.42 (not a 0..1 fraction). */
  marginPct: number;
  /** Materials-only share of the subtotal — the tax basis, kept visible. */
  materialsSubtotal: number;
}

function volumeDiscountBps(category: string | null | undefined, unit: string, qty: number): number {
  if (unit !== 'sqft' || !category || !VOLUME_TIER_CATEGORY.test(category)) return 0;
  if (qty > TIER_2_MIN_SQFT) return TIER_2_DISCOUNT_BPS;
  if (qty > TIER_1_MIN_SQFT) return TIER_1_DISCOUNT_BPS;
  return 0;
}

const UNMATCHED_MARKER = '[Needs review — no catalog match]';

/** Engine-owned math for rendering stored lines (PDF, public page): the list
 *  price minus its recorded tier. Display paths must not re-derive this. */
export function effectiveUnitPrice(listUnitPrice: number, discountBps: number): number {
  const cents = toCents(listUnitPrice);
  return fromCents(cents - centsTimesBps(cents, discountBps));
}

/** The fields of a stored proposal_line_items row the customer split needs. */
export interface StoredLineLike {
  needs_review: boolean | null;
  line_total: number;
  match_method: string | null;
}

/**
 * Customer-facing split of stored lines, shared by the PDF renderer and the
 * /p/[token] page. Unmatched lines exist only for the reviewer — an unpriced
 * line can never reach a customer — so they are dropped before the split.
 */
export function splitCustomerLines<T extends StoredLineLike>(
  lines: T[],
): { priced: T[]; optionalAddOns: T[] } {
  const visible = lines.filter((line) => line.match_method !== 'unmatched');
  return {
    priced: visible.filter((line) => !line.needs_review || line.line_total > 0),
    optionalAddOns: visible.filter((line) => line.needs_review && line.line_total === 0),
  };
}

export function priceProposal(
  matchedItems: MatchedItemInput[],
  context: PricingContext = {},
): PricedProposal {
  const taxRateBps = context.taxRateBps ?? PHOENIX_TAX_RATE_BPS;

  const lines: PricedLineItem[] = [];
  let subtotalCents = 0;
  let costTotalCents = 0;
  let materialsCents = 0;

  matchedItems.forEach((item, index) => {
    const { unitPrice } = item;
    // An item is unpriceable when retrieval marked it unmatched or the
    // catalog row carries no price. It stays visible at $0 for human review
    // instead of being silently dropped.
    const unmatched = item.matchMethod === 'unmatched' || unitPrice == null;

    if (unmatched) {
      lines.push({
        catalogItemId: null,
        sku: item.sku ?? null,
        catalogName: null,
        description: `${UNMATCHED_MARKER}: ${item.description || item.sku || 'scope item'}`,
        category: item.category ?? null,
        quantity: item.quantity ?? 0,
        unit: item.unit ?? 'unknown',
        unitPrice: 0,
        discountBps: 0,
        effectiveUnitPrice: 0,
        unitCost: 0,
        lineTotal: 0,
        minQty: item.minQty ?? null,
        materialsRatio: item.materialsRatio ?? null,
        matchMethod: item.matchMethod ?? 'unmatched',
        matchConfidence: item.matchConfidence ?? null,
        transcriptEvidence: item.transcriptEvidence ?? null,
        evidenceVerified: item.evidenceVerified ?? false,
        needsReview: true,
        sortOrder: index,
      });
      return;
    }

    const unitPriceCents = toCents(unitPrice);
    const unitCostCents = toCents(item.unitCost ?? 0);
    // Rule: quantity is coerced up to the catalog minimum, never down.
    const quantity = Math.max(item.quantity ?? 0, item.minQty ?? 0);

    const discountBps = volumeDiscountBps(item.category, item.unit ?? '', quantity);
    const effectiveUnitPriceCents = unitPriceCents - centsTimesBps(unitPriceCents, discountBps);
    const lineTotalCents = Math.round(quantity * effectiveUnitPriceCents);
    const lineCostCents = Math.round(quantity * unitCostCents);
    const ratio = Math.min(1, Math.max(0, item.materialsRatio ?? DEFAULT_MATERIALS_RATIO));
    const lineMaterialsCents = centsTimesRatio(lineTotalCents, ratio);

    subtotalCents += lineTotalCents;
    costTotalCents += lineCostCents;
    materialsCents += lineMaterialsCents;

    lines.push({
      catalogItemId: item.catalogItemId ?? null,
      sku: item.sku ?? null,
      catalogName: item.catalogName ?? null,
      description: item.description,
      category: item.category ?? null,
      quantity,
      unit: item.unit ?? 'unknown',
      // List price out, tier recorded separately — never bake the discount
      // into unitPrice, or re-pricing would discount the discount.
      unitPrice: fromCents(unitPriceCents),
      discountBps,
      effectiveUnitPrice: fromCents(effectiveUnitPriceCents),
      unitCost: fromCents(unitCostCents),
      lineTotal: fromCents(lineTotalCents),
      minQty: item.minQty ?? null,
      materialsRatio: item.materialsRatio ?? null,
      matchMethod: item.matchMethod ?? 'manual',
      matchConfidence: item.matchConfidence ?? null,
      transcriptEvidence: item.transcriptEvidence ?? null,
      evidenceVerified: item.evidenceVerified ?? false,
      // No quantity to price is a human problem, not an engine problem.
      needsReview: quantity <= 0,
      sortOrder: index,
    });
  });

  // Mobilization only makes sense when there is work to mobilize for: an
  // empty or fully-unpriced proposal carries no fee. Waived strictly above
  // the threshold — exactly $40,000 still pays.
  const hasBillableWork = subtotalCents > 0;
  const mobilizationCents =
    hasBillableWork && subtotalCents <= MOBILIZATION_WAIVER_SUBTOTAL_CENTS
      ? MOBILIZATION_FEE_CENTS
      : 0;
  const contingencyCents = centsTimesBps(subtotalCents, CONTINGENCY_BPS);
  const taxCents = centsTimesBps(materialsCents, taxRateBps);
  const totalCents = subtotalCents + mobilizationCents + contingencyCents + taxCents;

  const marginPct =
    totalCents > 0 ? Math.round(((totalCents - costTotalCents) / totalCents) * 10_000) / 100 : 0;

  return {
    lineItems: lines,
    subtotal: fromCents(subtotalCents),
    mobilizationFee: fromCents(mobilizationCents),
    contingency: fromCents(contingencyCents),
    tax: fromCents(taxCents),
    total: fromCents(totalCents),
    costTotal: fromCents(costTotalCents),
    marginPct,
    materialsSubtotal: fromCents(materialsCents),
  };
}
