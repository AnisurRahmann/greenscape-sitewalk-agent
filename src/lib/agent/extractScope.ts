import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { recordAgentRun, type AgentRunContext } from '@/lib/agent-runs';

import { estimateMessageCostUsd, SONNET_MODEL } from './pricing-table';

// ---------------------------------------------------------------------------
// Schema — single source of truth. The tool's input_schema is generated from
// it with z.toJSONSchema so the model contract and the validator cannot drift.
// ---------------------------------------------------------------------------

export const scopeExtractionSchema = z.object({
  project_summary: z.string().min(1),
  property: z.object({
    hoa_involved: z.boolean(),
    permit_likely: z.boolean(),
    access_notes: z.string().nullable(),
  }),
  customer_signals: z.object({
    budget_mentioned: z.number().nonnegative().nullable(),
    timeline_mentioned: z.string().nullable(),
    decision_maker_present: z.boolean().nullable(),
  }),
  items: z.array(
    z.object({
      raw_phrase: z.string().min(1),
      normalized_query: z.string().min(1),
      quantity: z.number().nullable(),
      unit: z.enum(['sqft', 'lf', 'ea', 'hr', 'day', 'unknown']),
      confidence: z.enum(['high', 'medium', 'low']),
      committed: z.boolean(),
      evidence: z.string().min(1),
    }),
  ),
  open_questions: z.array(z.string()),
});

export type ScopeExtraction = z.infer<typeof scopeExtractionSchema>;
export type VerifiedScopeItem = ScopeExtraction['items'][number] & { evidence_verified: boolean };

export interface ExtractScopeResult {
  extraction: Omit<ScopeExtraction, 'items'> & { items: VerifiedScopeItem[] };
  attempts: number;
  totalCostUsd: number;
}

// ---------------------------------------------------------------------------
// Minimal structural types for the model client. The real Anthropic client
// satisfies this interface; tests inject a stub instead (no network, no key).
// ---------------------------------------------------------------------------

export interface ScopeToolDefinition {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
}

export interface ScopeTextBlock {
  type: 'text';
  text: string;
}

export interface ScopeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type ScopeResponseBlock = ScopeTextBlock | ScopeToolUseBlock;

export interface ScopeModelResponse {
  content: ScopeResponseBlock[];
  usage: { input_tokens: number; output_tokens: number };
  stop_reason?: string | null;
}

export type ScopeMessageParam =
  | { role: 'user'; content: string | ScopeUserBlock[] }
  | { role: 'assistant'; content: ScopeResponseBlock[] };

export type ScopeUserBlock = {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: boolean;
  content: string;
};

export interface ScopeMessageCreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: ScopeMessageParam[];
  tools: ScopeToolDefinition[];
  tool_choice: { type: 'tool'; name: string };
}

export interface ScopeExtractionClient {
  messages: {
    create(
      args: ScopeMessageCreateParams,
      options?: { signal?: AbortSignal },
    ): Promise<ScopeModelResponse>;
  };
}

// ---------------------------------------------------------------------------
// Tool-forced extraction
// ---------------------------------------------------------------------------

export const TOOL_NAME = 'submit_scope_extraction';

// Rule 2: max 2 repair retries with the validation error fed back.
const MAX_REPAIR_RETRIES = 2;

const SYSTEM_PROMPT = `You are the scope extractor for Greenscape Pro, a hardscape design-build contractor in Phoenix. You read a contractor's spoken site-walk transcript and structure exactly what was said. You are not a salesperson: you never embellish, upsell, or infer work the customer did not discuss.

Hard rules:
- Never invent an item that was not spoken about. If it is not in the transcript, it does not exist.
- evidence must be copied character-for-character from the transcript. If you cannot copy a span exactly, omit the item and add an open_question instead.
- Never output prices, totals, or dollar figures of any kind — not in project_summary, not in items, not in open_questions.
- Mark committed=false for anything the customer merely asked about, speculated about, or deferred ("someday", "next year", "if the budget lands"). committed=true only for work they clearly want in this project.
- Quantities: only extract a number when one was actually stated or is directly derivable from stated dimensions (e.g. "thirty by thirty" -> 900 sqft). Otherwise quantity is null and unit is "unknown".
- normalized_query is a clean search phrase for catalog matching: keep the material, product type, and stated size; strip filler words, self-corrections, and locations.
- Capture HOA, permit, and access facts in property; budget, timeline, and decision-maker signals in customer_signals; anything you could not resolve in open_questions.

Submit exactly one tool call with the complete extraction.`;

const scopeTool: ScopeToolDefinition = {
  name: TOOL_NAME,
  description: 'Submit the structured scope extraction for this site-walk transcript.',
  // Generated from the zod contract so the model schema and the validator
  // cannot drift. The SDK types input_schema more narrowly than JSON Schema
  // itself; this boundary cast only widens the type — the value is generated,
  // never hand-maintained.
  input_schema: z.toJSONSchema(scopeExtractionSchema) as unknown as Anthropic.Tool.InputSchema,
};

export class ExtractionFailedError extends Error {
  readonly attempts: number;
  readonly lastError?: string;

  constructor(message: string, options: { attempts: number; lastError?: string }) {
    super(message);
    this.name = 'ExtractionFailedError';
    this.attempts = options.attempts;
    this.lastError = options.lastError;
  }
}

export interface ExtractScopeOptions {
  client?: ScopeExtractionClient;
  /** Audit sink; tests inject a spy so no database is needed. */
  recordRun?: typeof recordAgentRun;
  model?: string;
  maxTokens?: number;
  proposalId?: string | null;
  siteWalkId?: string | null;
  /** Dead-man switch: aborts the in-flight model call when tripped. */
  signal?: AbortSignal;
}

function normalizeForContainment(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Step 2 of the spec: verify evidence spans by normalised containment against
// the transcript. Never throws — the guardrail layer decides what to do with
// unverified items (CLAUDE.md rule 3).
function verifyEvidence(extraction: ScopeExtraction, transcript: string) {
  const haystack = normalizeForContainment(transcript);
  const items = extraction.items.map((item) => {
    const evidence = normalizeForContainment(item.evidence);
    return { ...item, evidence_verified: evidence.length > 0 && haystack.includes(evidence) };
  });
  return { ...extraction, items };
}

function summariseIssues(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
  const head = lines.slice(0, 10).join('\n');
  return lines.length > 10 ? `${head}\n(+${lines.length - 10} more issues)` : head;
}

function defaultClient(): ScopeExtractionClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new ExtractionFailedError('ANTHROPIC_API_KEY is not set', { attempts: 0 });
  }
  // Thin adapter: map the SDK's (wider) response type down to the blocks this
  // module understands, so the extraction logic stays SDK-agnostic.
  const anthropic = new Anthropic();
  return {
    messages: {
      create: async (args, options) => {
        const response = await anthropic.messages.create(args, {
          signal: options?.signal,
        });
        const content: ScopeResponseBlock[] = [];
        for (const block of response.content) {
          if (block.type === 'text') {
            content.push({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use') {
            content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input });
          }
        }
        return {
          content,
          usage: {
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
          },
          stop_reason: response.stop_reason,
        };
      },
    },
  };
}

export async function extractScope(
  transcript: string,
  opts: ExtractScopeOptions = {},
): Promise<ExtractScopeResult> {
  const client = opts.client ?? defaultClient();
  const recordRun = opts.recordRun ?? recordAgentRun;
  const model = opts.model ?? SONNET_MODEL;
  const ctx: AgentRunContext = {
    step: 'extract_scope',
    proposalId: opts.proposalId ?? null,
    siteWalkId: opts.siteWalkId ?? null,
  };

  if (!transcript.trim()) {
    // No LLM call happens, so there is nothing to bill — but the aborted run
    // is still audited so empty ingests are visible in the run log.
    await recordRun(ctx, {
      model,
      tokensIn: null,
      tokensOut: null,
      costUsd: 0,
      latencyMs: 0,
      status: 'aborted',
      error: 'transcript is empty',
    });
    throw new ExtractionFailedError('transcript is empty', { attempts: 0 });
  }

  const messages: ScopeMessageParam[] = [
    {
      role: 'user',
      content: `<transcript>\n${transcript}\n</transcript>\n\nExtract the scope and submit it with the ${TOOL_NAME} tool.`,
    },
  ];

  let attempts = 0;
  let totalCostUsd = 0;
  let lastError: string | undefined;

  for (attempts = 1; attempts <= MAX_REPAIR_RETRIES + 1; attempts += 1) {
    const startedAt = Date.now();
    const response = await client.messages.create(
      {
        model,
        max_tokens: opts.maxTokens ?? 4096,
        system: SYSTEM_PROMPT,
        messages,
        tools: [scopeTool],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      },
      { signal: opts.signal },
    );
    const latencyMs = Date.now() - startedAt;
    const costUsd = estimateMessageCostUsd(model, response.usage.input_tokens, response.usage.output_tokens);
    totalCostUsd += costUsd ?? 0;

    const toolUse = response.content.find(
      (block): block is ScopeToolUseBlock => block.type === 'tool_use' && block.name === TOOL_NAME,
    );

    let validationError: string | null = null;

    if (!toolUse) {
      validationError = 'model did not submit the extraction tool';
    } else {
      const result = scopeExtractionSchema.safeParse(toolUse.input);
      if (result.success) {
        await recordRun(ctx, {
          model,
          tokensIn: response.usage.input_tokens,
          tokensOut: response.usage.output_tokens,
          costUsd,
          latencyMs,
          status: 'ok',
        });
        return {
          extraction: verifyEvidence(result.data, transcript),
          attempts,
          totalCostUsd,
        };
      }
      validationError = summariseIssues(result.error);
    }

    const canRetry = attempts <= MAX_REPAIR_RETRIES;
    lastError = validationError;
    await recordRun(ctx, {
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      costUsd,
      latencyMs,
      status: canRetry ? 'retried' : 'failed',
      error: validationError,
    });

    if (!canRetry) {
      throw new ExtractionFailedError(
        `scope extraction failed validation after ${attempts} attempt(s)`,
        { attempts, lastError },
      );
    }

    // Rule 2: feed the validation error back into the conversation so the
    // repair attempt sees exactly what broke.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [
        toolUse
          ? {
              type: 'tool_result' as const,
              tool_use_id: toolUse.id,
              is_error: true,
              content: `Schema validation failed:\n${validationError}\n\nFix every issue and submit the extraction again with the ${TOOL_NAME} tool.`,
            }
          : {
              type: 'tool_result' as const,
              tool_use_id: 'unknown',
              is_error: true,
              content: `You did not call the ${TOOL_NAME} tool. Submit the extraction with it now.`,
            },
      ],
    });
  }

  throw new ExtractionFailedError(
    `scope extraction failed validation after ${attempts - 1} attempt(s)`,
    { attempts: attempts - 1, lastError },
  );
}
