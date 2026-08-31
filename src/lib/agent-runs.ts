import { getSupabaseAdmin } from './db/client';

export interface AgentRunContext {
  step: string;
  proposalId?: string | null;
  siteWalkId?: string | null;
}

export interface AgentRunInput {
  model: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
  latencyMs?: number | null;
  status: 'ok' | 'retried' | 'failed' | 'aborted';
  error?: string | null;
}

// Rule 4: every LLM call writes an agent_runs row. This helper never throws —
// a failing audit write must not mask the caller's real result or error, so a
// broken audit path surfaces on stderr instead.
export async function recordAgentRun(
  context: AgentRunContext,
  run: AgentRunInput,
): Promise<void> {
  try {
    const { error } = await getSupabaseAdmin().from('agent_runs').insert({
      step: context.step,
      model: run.model,
      tokens_in: run.tokensIn ?? null,
      tokens_out: run.tokensOut ?? null,
      cost_usd: run.costUsd ?? null,
      latency_ms: run.latencyMs ?? null,
      status: run.status,
      error: run.error ?? null,
      proposal_id: context.proposalId ?? null,
      site_walk_id: context.siteWalkId ?? null,
    });
    if (error) throw new Error(error.message);
  } catch (auditError) {
    console.error('agent_runs audit write failed:', auditError);
  }
}
