/**
 * Per-model token pricing (USD per million tokens). Cost observability is a
 * feature (CLAUDE.md rule 4): every agent_runs cost is computed here in
 * TypeScript from the API's real token counts — never estimated by a model.
 * Rates: Anthropic and OpenAI list prices, Aug 2026. Update when models rotate.
 */
import { llmProvider } from '@/lib/llm/chat-provider';

export interface ModelRate {
  inputUsdPerMTokens: number;
  outputUsdPerMTokens: number;
}

export const MODEL_RATES: Record<string, ModelRate> = {
  'claude-sonnet-4-5': { inputUsdPerMTokens: 3, outputUsdPerMTokens: 15 },
  'claude-haiku-4-5': { inputUsdPerMTokens: 1, outputUsdPerMTokens: 5 },
  'gpt-4o': { inputUsdPerMTokens: 2.5, outputUsdPerMTokens: 10 },
  'gpt-4o-mini': { inputUsdPerMTokens: 0.15, outputUsdPerMTokens: 0.6 },
};

// Model routing (CLAUDE.md): the cheap tier classifies and validates, the
// strong tier extracts and writes narrative. The provider is a switch
// (LLM_PROVIDER) so one vendor key can run the whole pipeline.
export const SONNET_MODEL = 'claude-sonnet-4-5';
export const HAIKU_MODEL = 'claude-haiku-4-5';
export const GPT_MODEL = 'gpt-4o';
export const GPT_MINI_MODEL = 'gpt-4o-mini';

export type ChatTier = 'fast' | 'standard';

/** The chat model for a tier under the configured provider. */
export function tierModel(tier: ChatTier): string {
  if (llmProvider() === 'openai') {
    return tier === 'fast' ? GPT_MINI_MODEL : GPT_MODEL;
  }
  return tier === 'fast' ? HAIKU_MODEL : SONNET_MODEL;
}

/** Returns null for unknown models so the audit row shows "unpriced" rather than a fake 0. */
export function estimateMessageCostUsd(
  model: string,
  tokensIn: number | null,
  tokensOut: number | null,
): number | null {
  // The OpenAI adapter records the API's returned model string, which carries
  // a dated snapshot suffix (e.g. gpt-4o-2024-08-06). Price a dated snapshot
  // at its family's listed rate; truly unknown models stay null.
  const rate = MODEL_RATES[model] ?? MODEL_RATES[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!rate) return null;
  const inputCost = ((tokensIn ?? 0) / 1_000_000) * rate.inputUsdPerMTokens;
  const outputCost = ((tokensOut ?? 0) / 1_000_000) * rate.outputUsdPerMTokens;
  return inputCost + outputCost;
}
