/**
 * Chat provider switch: `LLM_PROVIDER=anthropic` (default) or `openai`. This
 * is a switch, not a fallback — the configured provider owns every request
 * and failures fail loudly, so audit rows and eval numbers always describe
 * exactly one system.
 */

export type LlmProvider = 'anthropic' | 'openai';

export const LLM_PROVIDER_DEFAULT: LlmProvider = 'anthropic';

export function llmProvider(): LlmProvider {
  const value = process.env.LLM_PROVIDER ?? LLM_PROVIDER_DEFAULT;
  return value === 'openai' ? 'openai' : 'anthropic';
}

export interface ChatClient<A, R> {
  messages: {
    create(args: A, options?: { signal?: AbortSignal }): Promise<R>;
  };
}

/** Picks the default chat adapter for the configured provider. */
export function selectChatClient<A, R>(options: {
  anthropic: () => ChatClient<A, R>;
  openai: () => ChatClient<A, R>;
}): ChatClient<A, R> {
  return llmProvider() === 'openai' ? options.openai() : options.anthropic();
}
