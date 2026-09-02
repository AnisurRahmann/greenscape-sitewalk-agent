import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/lib/db/types';

export type CorrectionType = 'qty' | 'price' | 'remove' | 'remap' | 'add';

export interface CorrectionRecord {
  proposalId: string;
  lineItemId?: string | null;
  correctionType: CorrectionType;
  before?: unknown;
  after?: unknown;
  /** The query that produced the machine's original choice. */
  originalQuery?: string | null;
  rejectedCatalogItemId?: string | null;
  chosenCatalogItemId?: string | null;
  matchConfidenceAtTime?: number | null;
}

/**
 * One shared write path for review corrections — the labelled training
 * signal captured from every mutating review action, alongside its audit
 * row. A failed write is loud but never blocks the review action: the human
 * decision is already persisted by the time this runs.
 */
export async function recordCorrection(
  db: SupabaseClient<Database>,
  correction: CorrectionRecord,
): Promise<void> {
  const insert = {
    proposal_id: correction.proposalId,
    line_item_id: correction.lineItemId ?? null,
    correction_type: correction.correctionType,
    before: correction.before ?? null,
    after: correction.after ?? null,
    original_query: correction.originalQuery ?? null,
    rejected_catalog_item_id: correction.rejectedCatalogItemId ?? null,
    chosen_catalog_item_id: correction.chosenCatalogItemId ?? null,
    match_confidence_at_time: correction.matchConfidenceAtTime ?? null,
  };
  const { error } = await db.from('corrections').insert(
    insert as Database['public']['Tables']['corrections']['Insert'],
  );
  if (error) {
    console.error(
      `corrections write failed (${correction.correctionType}) for ${correction.proposalId}:`,
      error.message,
    );
  }
}
