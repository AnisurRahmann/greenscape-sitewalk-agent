import type { MatchedItemInput } from '@/lib/pricing/engine';

export interface ReviewLine {
  id: string;
  catalogItemId: string | null;
  sku: string | null;
  description: string;
  category: string | null;
  quantity: number;
  unit: string;
  /** Catalog list price — the tier in discountBps is applied by the engine. */
  unitPrice: number;
  discountBps: number;
  unitCost: number;
  /** Where unit_cost came from: 'catalog' | 'reviewer' | 'derived'. */
  costSource: string | null;
  lineTotal: number;
  matchMethod: string;
  matchConfidence: number | null;
  transcriptEvidence: string | null;
  evidenceVerified: boolean;
  needsReview: boolean;
  /** Soft-deleted in review — struck through, never priced or rendered. */
  excluded: boolean;
  excludedReason: string | null;
  minQty: number;
  materialsRatio: number;
  /** Optional add-ons were matched but not committed: priced at $0. */
  isOptionalAddOn: boolean;
}

export function toEngineInput(line: ReviewLine): MatchedItemInput {
  return {
    catalogItemId: line.catalogItemId,
    sku: line.sku,
    description: line.description,
    category: line.category,
    quantity: line.quantity,
    unit: line.unit,
    unitPrice: line.unitPrice,
    unitCost: line.unitCost,
    minQty: line.minQty,
    materialsRatio: line.materialsRatio,
    matchMethod: line.matchMethod,
    matchConfidence: line.matchConfidence,
    transcriptEvidence: line.transcriptEvidence,
    evidenceVerified: line.evidenceVerified,
  };
}

export const MATCH_CHIP_STYLES: Record<string, string> = {
  hybrid: 'bg-blue-100 text-blue-700',
  vector: 'bg-purple-100 text-purple-700',
  lexical: 'bg-emerald-100 text-emerald-700',
  fuzzy: 'bg-orange-100 text-orange-700',
  // Filled, not pastel: a human priced this line — it must be obvious.
  manual: 'bg-teal-600 text-white',
  unmatched: 'bg-red-100 text-red-700',
};
