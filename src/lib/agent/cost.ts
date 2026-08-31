import { getSupabaseAdmin } from '@/lib/db/client';

import { MODEL_RATES } from './pricing-table';

/**
 * costOf is the single place token costs are computed from the rate table.
 * Returns null for unknown models so callers can record "unpriced" instead
 * of a fake zero.
 */
export function costOf(
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  const rate = MODEL_RATES[model];
  if (!rate) return null;
  const inputUsd = ((tokensIn ?? 0) / 1_000_000) * rate.inputUsdPerMTokens;
  const outputUsd = ((tokensOut ?? 0) / 1_000_000) * rate.outputUsdPerMTokens;
  return inputUsd + outputUsd;
}

/**
 * Sums every agent_runs cost recorded against this proposal. Called before
 * each LLM step so the run can abort before crossing the ceiling rather
 * than discovering the overrun in the guardrails afterwards.
 */
export async function proposalCost(proposalId: string): Promise<number> {
  const { data, error } = await getSupabaseAdmin()
    .from('agent_runs')
    .select('cost_usd')
    .eq('proposal_id', proposalId);

  if (error) throw new Error(`failed to sum agent_runs: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.cost_usd ?? 0), 0);
}
