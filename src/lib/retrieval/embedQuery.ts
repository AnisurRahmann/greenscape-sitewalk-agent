import OpenAI from 'openai';

import { getSupabaseAdmin } from '../db/client';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_COST_PER_1M_TOKENS_USD = 0.02;

export interface AgentRunContext {
  step: string;
  proposalId?: string | null;
  siteWalkId?: string | null;
}

// Rule 4: every LLM call writes an agent_runs row. The audit insert must not
// mask the caller's real result or error, so a failing audit write only goes
// to stderr.
async function recordAgentRun(row: {
  step: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  status: 'ok' | 'failed';
  error?: string;
  context?: AgentRunContext;
}): Promise<void> {
  if (!row.context) return;
  try {
    const { error } = await getSupabaseAdmin().from('agent_runs').insert({
      step: row.context.step,
      model: row.model,
      tokens_in: row.tokensIn,
      tokens_out: row.tokensOut,
      cost_usd: row.costUsd,
      latency_ms: row.latencyMs,
      status: row.status,
      error: row.error ?? null,
      proposal_id: row.context.proposalId ?? null,
      site_walk_id: row.context.siteWalkId ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (auditError) {
    console.error('agent_runs audit write failed:', auditError);
  }
}

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
    const costUsd = (response.usage.total_tokens / 1_000_000) * EMBEDDING_COST_PER_1M_TOKENS_USD;
    await recordAgentRun({
      step: run?.step ?? 'retrieval.embed_query',
      model: EMBEDDING_MODEL,
      tokensIn: response.usage.prompt_tokens,
      tokensOut: 0,
      costUsd,
      latencyMs,
      status: 'ok',
      context: run,
    });

    return vector;
  } catch (err) {
    await recordAgentRun({
      step: run?.step ?? 'retrieval.embed_query',
      model: EMBEDDING_MODEL,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: Date.now() - startedAt,
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
      context: run,
    });
    throw err;
  }
}
