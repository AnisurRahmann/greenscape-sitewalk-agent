import OpenAI from 'openai';

import { recordAgentRun, type AgentRunContext } from '../agent-runs';

export { type AgentRunContext };

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_COST_PER_1M_TOKENS_USD = 0.02;

/**
 * Embeds query text for catalog matching. When `run` context is provided the
 * call is audited to agent_runs (rule 4); batch scripts that aggregate their
 * own cost omit it.
 */
export async function embedQuery(text: string, run?: AgentRunContext): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing — cannot embed query');

  const openai = new OpenAI({ apiKey });
  const startedAt = Date.now();

  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
    });
    const vector = response.data[0]?.embedding;
    if (!vector) throw new Error('no embedding returned');

    const latencyMs = Date.now() - startedAt;
    await recordAgentRun(
      run ?? { step: 'retrieval.embed_query' },
      {
        model: EMBEDDING_MODEL,
        tokensIn: response.usage.prompt_tokens,
        tokensOut: 0,
        costUsd: (response.usage.total_tokens / 1_000_000) * EMBEDDING_COST_PER_1M_TOKENS_USD,
        latencyMs,
        status: 'ok',
      },
    );

    return vector;
  } catch (err) {
    await recordAgentRun(
      run ?? { step: 'retrieval.embed_query' },
      {
        model: EMBEDDING_MODEL,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      },
    );
    throw err;
  }
}
