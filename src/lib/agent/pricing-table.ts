/**
 * Per-model token pricing (USD per million tokens). Cost observability is a
 * feature (CLAUDE.md rule 4): every agent_runs cost is computed here in
 * TypeScript from the API's real token counts — never estimated by a model.
 * Rates: Anthropic list prices, Aug 2026. Update when models rotate.
 */
export interface ModelRate {
  inputUsdPerMTokens: number;
  outputUsdPerMTokens: number;
}

export const MODEL_RATES: Record<string, ModelRate> = {
  'claude-sonnet-4-5': { inputUsdPerMTokens: 3, outputUsdPerMTokens: 15 },
  'claude-haiku-4-5': { inputUsdPerMTokens: 1, outputUsdPerMTokens: 5 },
};

// Model routing (CLAUDE.md): Haiku for classification/validation, Sonnet for
// scope extraction and proposal narrative, never Opus.
export const SONNET_MODEL = 'claude-sonnet-4-5';
export const HAIKU_MODEL = 'claude-haiku-4-5';

/** Returns null for unknown models so the audit row shows "unpriced" rather than a fake 0. */
export function estimateMessageCostUsd(
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  const rate = MODEL_RATES[model];
  if (!rate) return null;
  const inputCost = ((tokensIn ?? 0) / 1_000_000) * rate.inputUsdPerMTokens;
  const outputCost = ((tokensOut ?? 0) / 1_000_000) * rate.outputUsdPerMTokens;
  return inputCost + outputCost;
}
