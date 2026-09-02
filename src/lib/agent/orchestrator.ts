/**
 * The staged site-walk pipeline:
 *   transcribe -> classify -> extract -> match -> price -> guardrails -> narrative -> persist
 *
 * Every step is wrapped so a failure records agent_runs, advances the
 * proposal's step_status, and stops the run gracefully — a broken step never
 * throws the whole run away or loses what earlier steps produced.
 *
 * Caps enforced here and in the step modules:
 * - max 2 extraction repairs (extractScope)
 * - max 1 narrative regeneration (draftNarrative)
 * - 120s wall clock via AbortController (aborts in-flight model calls and
 *   gates every step boundary)
 * - $0.75 cost ceiling checked before each LLM call
 *
 * Never call this from request scope directly: it runs for up to two
 * minutes. Trigger it through next/server after() (see the ingest action)
 * and poll proposals.step_status for progress.
 */

import { recordAgentRun } from '@/lib/agent-runs';
import { getSupabaseAdmin } from '@/lib/db/client';
import type { Json } from '@/lib/db/types';
import { transcribeSiteWalk } from '@/lib/ingest/transcribe';
import { PROPOSAL_COST_CEILING_USD, runGuardrails, type GuardrailLineItem } from '@/lib/guardrails';
import { embedQuery } from '@/lib/retrieval/embedQuery';
import { matchCatalog, type FusedCandidate } from '@/lib/retrieval/matchCatalog';
import { priceProposal, type MatchedItemInput, type PricedLineItem } from '@/lib/pricing/engine';

import { classifyTranscript, type Classification } from './classify';
import { proposalCost } from './cost';
import { draftNarrative } from './draftNarrative';
import { extractScope } from './extractScope';

const WALL_CLOCK_LIMIT_MS = 120_000;

const STEP_NAMES = [
  'transcribe',
  'classify',
  'extract',
  'match',
  'price',
  'guardrails',
  'narrative',
  'persist',
] as const;
type StepName = (typeof STEP_NAMES)[number];
type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface StepStatusDoc {
  started_at: string;
  steps: Record<StepName, StepState>;
  current: StepName | null;
  error?: string;
  classification?: { is_sitewalk: boolean; project_type: string; size_band: string };
}

export interface PipelineResult {
  siteWalkId: string;
  proposalId: string | null;
  status: 'completed' | 'needs_review' | 'aborted' | 'failed';
  failedStep?: StepName;
  message?: string;
}

class BudgetExceededError extends Error {
  constructor(spentUsd: number) {
    super(
      `cost ceiling exceeded: $${spentUsd.toFixed(2)} spent of $${PROPOSAL_COST_CEILING_USD.toFixed(2)} ceiling`,
    );
    this.name = 'BudgetExceededError';
  }
}

// Step -> model attribution for step-level failure audit rows. LLM calls
// audit themselves; these rows attribute pipeline/infrastructure failures.
const STEP_MODEL: Record<StepName, string> = {
  transcribe: 'whisper-1',
  classify: 'claude-haiku-4-5',
  extract: 'claude-sonnet-4-5',
  match: 'text-embedding-3-small',
  price: 'pipeline',
  guardrails: 'pipeline',
  narrative: 'claude-sonnet-4-5',
  persist: 'pipeline',
};

export async function runSitewalkPipeline(siteWalkId: string): Promise<PipelineResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WALL_CLOCK_LIMIT_MS);
  const startedAt = Date.now();
  const db = getSupabaseAdmin();

  let proposalId: string | null = null;
  let failedStep: StepName | undefined;
  const stepStates = Object.fromEntries(STEP_NAMES.map((name) => [name, 'pending'])) as Record<
    StepName,
    StepState
  >;
  const stepDoc: StepStatusDoc = {
    started_at: new Date(startedAt).toISOString(),
    steps: stepStates,
    current: null,
  };

  async function saveStepStatus(): Promise<void> {
    if (proposalId === null) return;
    try {
      const { error } = await db
        .from('proposals')
        .update({ step_status: stepDoc as unknown as Json })
        .eq('id', proposalId);
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error(`step_status write failed for proposal ${proposalId}:`, err);
    }
  }

  /** Runs one pipeline step: tracks state, aborts on the dead-man switch,
   *  and records failures without unwinding the run. */
  async function step<T>(name: StepName, fn: () => Promise<T>): Promise<{ output: T } | null> {
    if (controller.signal.aborted) {
      stepStates[name] = 'skipped';
      stepDoc.error = 'wall clock limit reached';
      await saveStepStatus();
      return null;
    }
    stepStates[name] = 'running';
    stepDoc.current = name;
    await saveStepStatus();

    const startedStepAt = Date.now();
    try {
      const output = await fn();
      stepStates[name] = 'done';
      stepDoc.current = null;
      await saveStepStatus();
      // Persist-style steps legitimately return undefined; the wrapper object
      // keeps "step failed" distinct from "step produced nothing".
      return { output };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof BudgetExceededError) budgetAbort = true;
      lastFailureMessage = message;
      stepStates[name] = 'failed';
      stepDoc.current = null;
      stepDoc.error = `${name}: ${message}`;
      failedStep = name;
      await saveStepStatus();
      await recordAgentRun({ step: `pipeline.${name}` }, {
        model: STEP_MODEL[name],
        tokensIn: null,
        tokensOut: null,
        costUsd: 0,
        latencyMs: Date.now() - startedStepAt,
        status: 'failed',
        error: message,
      });
      return null;
    }
  }

  /** Checked immediately before every LLM call (rule: cost observability). */
  async function assertWithinBudget(): Promise<void> {
    const pid = proposalId;
    if (pid === null) return;
    const spent = await proposalCost(pid);
    if (spent >= PROPOSAL_COST_CEILING_USD) throw new BudgetExceededError(spent);
  }

  /** Marks remaining steps skipped, records the terminal proposal state
   *  (needs_review for failures, rejected for non-site-walks), and produces
   *  the pipeline result. */
  async function finish(
    status: PipelineResult['status'],
    failedStepName?: StepName,
    message?: string,
    terminalProposalStatus: 'needs_review' | 'rejected' = 'needs_review',
  ): Promise<PipelineResult> {
    for (const name of STEP_NAMES) {
      if (stepStates[name] === 'pending' || stepStates[name] === 'running') {
        stepStates[name] = 'skipped';
      }
    }
    stepDoc.current = null;
    if (message !== undefined) stepDoc.error = message;
    if (proposalId !== null) {
      try {
        const { error } = await db
          .from('proposals')
          .update({ status: terminalProposalStatus, step_status: stepDoc as unknown as Json })
          .eq('id', proposalId);
        if (error) throw new Error(error.message);
      } catch (err) {
        console.error('final proposal update failed:', err);
      }
    }
    const effectiveStatus: PipelineResult['status'] =
      budgetAbort && status === 'failed' ? 'aborted' : status;
    return {
      siteWalkId,
      proposalId,
      status: effectiveStatus,
      failedStep: failedStepName,
      message: message ?? lastFailureMessage,
    };
  }

  let budgetAbort = false;
  let lastFailureMessage: string | undefined;
  let result: PipelineResult = {
    siteWalkId,
    proposalId: null,
    status: 'failed',
    message: 'pipeline did not complete',
  };

  try {
    // ---- load the site walk -------------------------------------------------
    const walkQuery = await db
      .from('site_walks')
      .select('id, lead_id, input_mode, transcript, audio_path')
      .eq('id', siteWalkId)
      .single();
    const walk = walkQuery.data;
    if (!walk) {
      throw new Error(walkQuery.error?.message ?? 'site walk not found');
    }

    // ---- seed the proposal row so step_status has a home --------------------
    const insert = await db
      .from('proposals')
      .insert({ lead_id: walk.lead_id, site_walk_id: siteWalkId, status: 'draft', step_status: stepDoc as unknown as Json })
      .select('id')
      .single();
    if (insert.error || !insert.data) {
      throw new Error(insert.error?.message ?? 'failed to create proposal row');
    }
    const pid: string = insert.data.id;
    proposalId = pid;
    result.proposalId = pid;

    // ---- transcribe ---------------------------------------------------------
    let transcript: string = walk.transcript ?? '';
    if (walk.input_mode === 'audio') {
      const audioPath = walk.audio_path;
      const ok = await step('transcribe', async () => {
        await assertWithinBudget();
        if (!audioPath) throw new Error('audio site walk has no audio_path');
        await transcribeSiteWalk(siteWalkId, audioPath);
        const fresh = await db
          .from('site_walks')
          .select('transcript')
          .eq('id', siteWalkId)
          .single();
        transcript = fresh.data?.transcript ?? '';
        if (!transcript.trim()) throw new Error('transcription produced an empty transcript');
      });
      if (!ok) return await finish('failed');
    } else {
      stepStates.transcribe = 'skipped';
      await saveStepStatus();
    }
    if (!transcript.trim()) {
      stepDoc.error = 'no transcript available';
      return await finish('failed', 'transcribe');
    }

    // ---- classify (cheap Haiku gate) ---------------------------------------
    let classification: Classification | null = null;
    const classified = await step('classify', async () => {
      await assertWithinBudget();
      const { classification } = await classifyTranscript(transcript, {
        proposalId: pid,
        signal: controller.signal,
      });
      return classification;
    });
    if (!classified) return await finish('failed', 'classify');
    classification = classified.output;
    stepDoc.classification = {
      is_sitewalk: classification.is_sitewalk,
      project_type: classification.project_type,
      size_band: classification.size_band,
    };
    await saveStepStatus();

    if (!classification.is_sitewalk) {
      // Cheap gate worked: no Sonnet tokens were spent on a lunch memo.
      return await finish('aborted', 'classify', `not a site walk (${classification.project_type})`, 'rejected');
    }

    // ---- extract ------------------------------------------------------------
    const extracted = await step('extract', async () => {
      await assertWithinBudget();
      return extractScope(transcript, {
        proposalId: pid,
        siteWalkId,
        signal: controller.signal,
      });
    });
    if (!extracted) return await finish('failed', 'extract');
    const extraction = extracted.output.extraction;

    // ---- match --------------------------------------------------------------
    const matched = await step('match', async () => {
      const results: Array<{ item: (typeof extraction)['items'][number]; input: MatchedItemInput }> = [];
      for (const item of extraction.items) {
        const queryEmbedding = await embedQuery(item.normalized_query);
        const candidates = await matchCatalog(item.normalized_query, {
          queryEmbedding,
          topK: 1,
        });
        const candidate: FusedCandidate | null = candidates[0] ?? null;
        const cat = candidate && candidate.matchMethod !== 'unmatched' ? candidate.catalogItem : null;

        results.push({
          item,
          input: cat
            ? {
                catalogItemId: cat.id,
                sku: cat.sku,
                // Snapshot the catalog identity: the line renders the catalog
                // NAME, so later catalog renames cannot rewrite a stored
                // proposal. The raw spoken phrase lives only in
                // transcript_evidence.
                catalogName: cat.name,
                description: cat.name,
                category: cat.category,
                quantity: item.quantity,
                unit: cat.unit,
                unitPrice: cat.unit_price,
                unitCost: cat.unit_cost,
                minQty: cat.min_qty,
                matchMethod: candidate.matchMethod,
                matchConfidence: candidate.confidence,
                transcriptEvidence: item.evidence,
                evidenceVerified: item.evidence_verified,
              }
            : {
                // No catalog match: fall back to the normalized query —
                // never the raw phrase — until a human prices the line.
                description: item.normalized_query,
                quantity: item.quantity,
                unit: item.unit,
                matchMethod: 'unmatched',
                transcriptEvidence: item.evidence,
                evidenceVerified: item.evidence_verified,
              },
        });
      }
      return results;
    });
    if (!matched) return await finish('failed', 'match');

    // ---- price --------------------------------------------------------------
    // Uncommitted items are matched too, but priced at $0: they surface as an
    // optional add-ons section and guardrail G7 verifies none leaked in.
    const pricing = await step('price', async () => {
      const committedInputs = matched.output.filter((m) => m.item.committed).map((m) => m.input);
      const proposal = priceProposal(committedInputs);
      const optionalLines = matched.output
        .filter((m) => !m.item.committed)
        .map((m, i): PricedLineItem => ({
          catalogItemId: m.input.catalogItemId ?? null,
          sku: m.input.sku ?? null,
          catalogName: m.input.catalogName ?? null,
          description: `${m.input.description} (optional add-on)`,
          category: m.input.category ?? null,
          quantity: m.input.quantity ?? 0,
          unit: m.input.unit ?? 'unknown',
          unitPrice: 0,
          discountBps: 0,
          effectiveUnitPrice: 0,
          unitCost: 0,
          lineTotal: 0,
          minQty: m.input.minQty ?? null,
          materialsRatio: m.input.materialsRatio ?? null,
          matchMethod: m.input.matchMethod ?? 'manual',
          matchConfidence: m.input.matchConfidence ?? null,
          transcriptEvidence: m.input.transcriptEvidence ?? null,
          evidenceVerified: m.input.evidenceVerified ?? false,
          needsReview: true,
          sortOrder: proposal.lineItems.length + i,
        }));
      return { proposal, optionalLines };
    });
    if (!pricing) return await finish('failed', 'price');
    const { proposal: priced, optionalLines } = pricing.output;
    const allLines: PricedLineItem[] = [...priced.lineItems, ...optionalLines];

    // ---- guardrails ---------------------------------------------------------
    const verdict = await step('guardrails', async () => {
      const referencedIds = allLines
        .map((line) => line.catalogItemId)
        .filter((id): id is string => id !== null);
      const existing = await db
        .from('catalog_items')
        .select('id')
        .in('id', referencedIds);
      if (existing.error) throw new Error(existing.error.message);
      const validCatalogIds = new Set((existing.data ?? []).map((row) => row.id));

      const guardrailLines: GuardrailLineItem[] = allLines.map((line) => ({
        sku: line.sku,
        catalogItemId: line.catalogItemId,
        description: line.description,
        category: line.category,
        quantity: line.quantity,
        lineTotal: line.lineTotal,
        matchConfidence: line.matchConfidence,
        matchMethod: line.matchMethod,
        committed: optionalLines.includes(line) ? false : true,
      }));

      return runGuardrails({
        proposalId: pid,
        extraction: {
          schemaValid: true,
          retryCount: extracted.output.attempts - 1,
          items: extraction.items.map((item, i) => ({
            rawPhrase: item.raw_phrase,
            committed: item.committed,
            evidenceVerified: item.evidence_verified,
            matchMethod: matched.output[i]?.input.matchMethod ?? null,
          })),
        },
        proposal: {
          total: priced.total,
          marginPct: priced.marginPct,
          lineItems: guardrailLines,
        },
        validCatalogIds,
        agentRunCostUsd: await proposalCost(pid),
        elapsedMs: Date.now() - startedAt,
      });
    });
    if (!verdict) return await finish('failed', 'guardrails');

    // ---- narrative ----------------------------------------------------------
    const narrative = await step('narrative', async () => {
      await assertWithinBudget();
      return draftNarrative(
        {
          projectSummary: extraction.project_summary,
          property: {
            hoaInvolved: extraction.property.hoa_involved,
            permitLikely: extraction.property.permit_likely,
            accessNotes: extraction.property.access_notes,
          },
          totals: {
            subtotal: priced.subtotal,
            mobilizationFee: priced.mobilizationFee,
            contingency: priced.contingency,
            tax: priced.tax,
            total: priced.total,
          },
          lineItems: priced.lineItems.map((line) => ({
            sku: line.sku,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
          })),
        },
        { proposalId: pid, signal: controller.signal },
      );
    });
    if (!narrative) return await finish('failed', 'narrative');

    // ---- persist ------------------------------------------------------------
    const persisted = await step('persist', async () => {
      const status = verdict.output.proposalStatus ?? 'draft';
      const update = await db
        .from('proposals')
        .update({
          subtotal: priced.subtotal,
          mobilization_fee: priced.mobilizationFee,
          contingency: priced.contingency,
          tax: priced.tax,
          total: priced.total,
          cost_total: priced.costTotal,
          margin_pct: priced.marginPct,
          narrative: JSON.stringify(narrative.output.narrative),
          exclusions: narrative.output.narrative.exclusions.join('\n'),
          status,
        })
        .eq('id', pid);
      if (update.error) throw new Error(update.error.message);

      const rows = allLines.map((line) => ({
        proposal_id: pid,
        catalog_item_id: line.catalogItemId,
        // Snapshot identity alongside the price snapshot: stored proposals
        // stay reproducible even if the catalog changes later.
        sku: line.sku,
        catalog_name: line.catalogName,
        cost_source: line.unitCost > 0 ? 'catalog' : null,
        description: line.description,
        qty: line.quantity,
        unit: line.unit,
        unit_price: line.unitPrice,
        discount_bps: line.discountBps,
        unit_cost: line.unitCost,
        line_total: line.lineTotal,
        match_method: line.matchMethod,
        match_confidence: line.matchConfidence,
        transcript_evidence: line.transcriptEvidence,
        evidence_verified: line.evidenceVerified,
        needs_review: line.needsReview,
        sort_order: line.sortOrder,
      }));
      const inserted = await db.from('proposal_line_items').insert(rows);
      if (inserted.error) throw new Error(inserted.error.message);
    });
    if (!persisted) return await finish('failed', 'persist');

    result = {
      siteWalkId,
      proposalId,
      status:
        verdict.output.aborted
          ? 'aborted'
          : verdict.output.status === 'needs_review'
            ? 'needs_review'
            : 'completed',
      message:
        verdict.output.blocking.length > 0
          ? `blocked by: ${verdict.output.blocking.map((rule) => rule.rule).join(', ')}`
          : undefined,
    };
    return result;
  } catch (err) {
    result = {
      ...result,
      status: 'failed',
      failedStep,
      message: err instanceof Error ? err.message : String(err),
    };
    await saveStepStatus().catch(() => {});
    return result;
  } finally {
    clearTimeout(timer);
  }
}
