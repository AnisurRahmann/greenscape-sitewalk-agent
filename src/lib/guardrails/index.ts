/**
 * Nine-rule validation layer between pricing and anything customer-facing.
 *
 * Every rule is a pure function: data in, { rule, severity, passed, detail }
 * out — no I/O, no model calls. The orchestrator (runGuardrails) runs them
 * all, persists every result to guardrail_events, and returns an aggregate
 * verdict.
 *
 * Verdict semantics:
 * - any block  -> proposal.status = 'needs_review'; the verdict carries
 *                inlineByLine so the UI can show the blocking rules directly
 *                on the offending line items.
 * - any warn   -> shown as badges, never gates.
 * - G8/G9 fail -> verdict.aborted; the orchestration stops.
 *
 * Nothing ever auto-sends. Approval is always human in this version.
 *
 * AUTO-APPROVE TIER (on record for the future): it would be safe to
 * auto-approve ONLY when ALL of the following hold:
 *   1. proposal total < $15,000,
 *   2. zero blocking rules failed,
 *   3. zero warn rules failed (including G3 unmatched and G5 bounds),
 *   4. every line item's match_confidence > 0.90.
 * Until those are the gating criteria, a successful guardrail run still
 * requires explicit human approval before anything reaches a customer
 * (CLAUDE.md rule 5).
 */

import { getSupabaseAdmin } from '@/lib/db/client';

import {
  evaluateRules,
  type GuardrailContext,
  type GuardrailDeps,
  type GuardrailEventSink,
  type GuardrailResult,
} from './rules';

// Re-export the pure rules and types so existing imports keep working.
export * from './rules';

// ---------------------------------------------------------------------------
// Orchestration: run everything, persist everything, aggregate the verdict.
// ---------------------------------------------------------------------------

export type GuardrailStatus = 'passed' | 'needs_review' | 'aborted';

export interface GuardrailVerdict {
  status: GuardrailStatus;
  /** Set to 'needs_review' when any block failed; null leaves status as-is. */
  proposalStatus: 'needs_review' | null;
  aborted: boolean;
  results: GuardrailResult[];
  blocking: GuardrailResult[];
  warns: GuardrailResult[];
  /** line index -> blocking rule ids, for inline UI display on line items. */
  inlineByLine: Record<number, string[]>;
}

function defaultSaveEvents(): GuardrailEventSink {
  return async (proposalId, results) => {
    const { error } = await getSupabaseAdmin()
      .from('guardrail_events')
      .insert(
        results.map((result) => ({
          proposal_id: proposalId,
          rule: result.rule,
          severity: result.severity,
          passed: result.passed,
          detail:
            result.lineIndex === undefined
              ? result.detail
              : { ...result.detail, line_index: result.lineIndex },
        })),
      );
    if (error) throw new Error(error.message);
  };
}

export async function runGuardrails(
  context: GuardrailContext,
  deps: GuardrailDeps = {},
): Promise<GuardrailVerdict> {
  const results = evaluateRules(context);

  // Persistence is audit, not gating: a failed write is loud on stderr but
  // never changes the verdict, and every result is attempted regardless of
  // earlier failures (rule 4 spirit — observability is not optional).
  const saveEvents = deps.saveEvents ?? defaultSaveEvents();
  try {
    await saveEvents(context.proposalId, results);
  } catch (err) {
    console.error(`guardrail_events write failed for proposal ${context.proposalId}:`, err);
  }

  const failed = results.filter((result) => !result.passed);
  const blocking = failed.filter((result) => result.severity === 'block');
  const warns = failed.filter((result) => result.severity === 'warn');
  const aborted = blocking.some(
    (result) => result.rule === 'G8_cost_ceiling' || result.rule === 'G9_wall_clock',
  );

  const inlineByLine: Record<number, string[]> = {};
  for (const block of blocking) {
    if (block.lineIndex === undefined) continue;
    const existing = inlineByLine[block.lineIndex] ?? [];
    existing.push(block.rule);
    inlineByLine[block.lineIndex] = existing;
  }

  return {
    status: aborted ? 'aborted' : blocking.length > 0 ? 'needs_review' : 'passed',
    proposalStatus: blocking.length > 0 ? 'needs_review' : null,
    aborted,
    results,
    blocking,
    warns,
    inlineByLine,
  };
}
