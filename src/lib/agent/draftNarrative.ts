import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { recordAgentRun, type AgentRunContext } from '@/lib/agent-runs';

import { estimateMessageCostUsd, SONNET_MODEL } from './pricing-table';

// CRITICAL GROUNDING CONSTRAINT: the narrative model receives ONLY the priced
// line items (descriptions/quantities/units), the project summary and the
// property context. It does NOT receive the raw transcript, so it cannot
// reintroduce scope the pricing engine rejected. unit_cost, margin and
// cost_total are deliberately absent from the input type — customer-facing
// copy never sees cost data.

export interface NarrativeLineItem {
  sku: string | null;
  description: string;
  quantity: number;
  unit: string;
}

export interface NarrativeContext {
  projectSummary: string;
  property: { hoaInvolved: boolean; permitLikely: boolean; accessNotes: string | null };
  totals: {
    subtotal: number;
    mobilizationFee: number;
    contingency: number;
    tax: number;
    total: number;
  };
  lineItems: NarrativeLineItem[];
}

export interface NarrativeOptions {
  client?: NarrativeClient;
  recordRun?: typeof recordAgentRun;
  model?: string;
  maxTokens?: number;
  proposalId?: string | null;
  /** Dead-man switch: aborts the in-flight model call when tripped. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Output contract. Shape-only here so z.toJSONSchema can build the tool
// schema; the "3 to 4 sentences" and grounding rules are enforced by the
// post-check (retryable) instead of an unrepresentable zod refine.
// ---------------------------------------------------------------------------

export const narrativeSchema = z.object({
  scope_overview: z.string().min(1),
  whats_included: z.array(z.string().min(1)).min(1),
  exclusions: z.array(z.string().min(1)),
  timeline_sentence: z.string().min(1),
});

export type NarrativeOutput = z.infer<typeof narrativeSchema>;

export interface NarrativeResult {
  narrative: NarrativeOutput;
  attempts: number;
  usedFallback: boolean;
  totalCostUsd: number;
}

// ---------------------------------------------------------------------------
// Minimal structural model-client types (SDK client satisfies; tests stub).
// ---------------------------------------------------------------------------

export interface NarrativeToolDefinition {
  name: string;
  description: string;
  input_schema: Anthropic.Tool.InputSchema;
}

export interface NarrativeTextBlock {
  type: 'text';
  text: string;
}

export interface NarrativeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export type NarrativeResponseBlock = NarrativeTextBlock | NarrativeToolUseBlock;

export interface NarrativeModelResponse {
  content: NarrativeResponseBlock[];
  usage: { input_tokens: number; output_tokens: number };
}

export type NarrativeMessageParam =
  | { role: 'user'; content: string | NarrativeUserBlock[] }
  | { role: 'assistant'; content: NarrativeResponseBlock[] };

export type NarrativeUserBlock = {
  type: 'tool_result';
  tool_use_id: string;
  is_error?: boolean;
  content: string;
};

export interface NarrativeMessageCreateParams {
  model: string;
  max_tokens: number;
  system: string;
  messages: NarrativeMessageParam[];
  tools: NarrativeToolDefinition[];
  tool_choice: { type: 'tool'; name: string };
}

export interface NarrativeClient {
  messages: {
    create(
      args: NarrativeMessageCreateParams,
      options?: { signal?: AbortSignal },
    ): Promise<NarrativeModelResponse>;
  };
}

// ---------------------------------------------------------------------------
// Timeline: pure function of total value — the one schedule rule the client
// gave us. Used by the model prompt indirectly and by the fallback directly.
// ---------------------------------------------------------------------------

export function timelineForTotal(total: number): string {
  if (total < 20_000) {
    return 'From mobilization to final walkthrough, this project is scheduled for completion in about 2 weeks.';
  }
  if (total <= 50_000) {
    return 'From mobilization to final walkthrough, this project is scheduled for completion in about 3 to 4 weeks.';
  }
  return 'From mobilization to final walkthrough, this project is scheduled for completion in about 5 to 6 weeks.';
}

// ---------------------------------------------------------------------------
// Numeric leakage check: no dollar figure may appear unless it is one of the
// computed totals. Prose may round a total to whole dollars; anything else is
// invented.
// ---------------------------------------------------------------------------

const CURRENCY_PATTERN = /\$\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:dollars|USD)\b/gi;

export function findLeakedFigures(text: string, allowedTotals: number[]): string[] {
  const matches = text.match(CURRENCY_PATTERN) ?? [];
  const leaked = new Set<string>();
  for (const match of matches) {
    const parsed = Number.parseFloat(match.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(parsed)) continue;
    const ok = allowedTotals.some(
      (total) => parsed === total || parsed === Math.round(total),
    );
    if (!ok) leaked.add(match.trim());
  }
  return [...leaked];
}

function normalizeForGrounding(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function sentenceCount(text: string): number {
  return (text.match(/[^.!?]+[.!?]+/g) ?? []).length;
}

export function renderNarrativeText(narrative: NarrativeOutput): string {
  return [
    narrative.scope_overview,
    ...narrative.whats_included,
    ...narrative.exclusions,
    narrative.timeline_sentence,
  ].join('\n');
}

/** Every violated grounding rule, for the repair feedback and the audit row. */
export function narrativeViolations(
  narrative: NarrativeOutput,
  context: NarrativeContext,
): string[] {
  const violations: string[] = [];
  const text = renderNarrativeText(narrative);

  const allowedTotals = [
    context.totals.subtotal,
    context.totals.mobilizationFee,
    context.totals.contingency,
    context.totals.tax,
    context.totals.total,
  ];
  const leaked = findLeakedFigures(text, allowedTotals);
  if (leaked.length > 0) {
    violations.push(
      `dollar figures that do not appear in the computed totals: ${leaked.join(', ')}. Remove every dollar amount.`,
    );
  }

  const sentences = sentenceCount(narrative.scope_overview);
  if (sentences < 3 || sentences > 5) {
    violations.push(`scope_overview must be 3 to 4 sentences (found ${sentences}).`);
  }

  const descriptions = context.lineItems.map((line) => normalizeForGrounding(line.description));
  narrative.whats_included.forEach((bullet, index) => {
    const bulletText = normalizeForGrounding(bullet);
    const grounded = descriptions.some((d) => d.length > 0 && bulletText.includes(d));
    if (!grounded) {
      violations.push(
        `whats_included bullet ${index + 1} ("${bullet}") does not reference any priced line item description.`,
      );
    }
  });

  return violations;
}

// ---------------------------------------------------------------------------
// Deterministic fallback — used when the model cannot produce clean copy.
// ---------------------------------------------------------------------------

export function fallbackNarrative(context: NarrativeContext): NarrativeOutput {
  const included = context.lineItems.map(
    (line) => `${line.description} (${line.quantity} ${line.unit})`,
  );
  return {
    scope_overview:
      `${context.projectSummary} ` +
      'Greenscape Pro will handle the full scope below with our own crews, premium materials, and the jobsite care Phoenix homeowners expect.',
    whats_included: included.length > 0 ? included : ['Full scope as detailed in this proposal'],
    exclusions: [
      "Anything not explicitly listed under What's included",
      'Permits, engineering, and HOA fees unless itemized above',
      'Design changes after proposal approval',
    ],
    timeline_sentence: timelineForTotal(context.totals.total),
  };
}

// ---------------------------------------------------------------------------
// Tool-forced draft with one numeric-leakage repair, then deterministic fallback.
// ---------------------------------------------------------------------------

export const TOOL_NAME = 'submit_proposal_narrative';
const MAX_ATTEMPTS = 2;

const SYSTEM_PROMPT = `You write customer-facing proposal copy for Greenscape Pro, a premium hardscape design-build contractor in Phoenix. Confident, premium, concrete voice — no pressure language, no fluff.

You receive the priced scope (line items), the project summary, and property notes. Write ONLY about what appears there. Never invent scope, materials, brands, or numbers.

Rules:
- scope_overview: exactly 3 to 4 sentences describing the work being done.
- Every whats_included bullet must contain the corresponding line item description verbatim, phrased for a homeowner.
- exclusions: premium-contractor standard exclusions plus anything the scope clearly leaves out.
- timeline_sentence: one plain-English schedule sentence; base the duration only on overall project size (small projects about 2 weeks, mid-size 3 to 4 weeks, large 5 to 6 weeks). No dates, no dollar amounts.
- NEVER write any dollar figure, price, or amount in any field. The proposal document shows the numbers; your copy must not.

Submit exactly one tool call.`;

export class NarrativeDraftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NarrativeDraftError';
  }
}

function defaultClient(): NarrativeClient {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new NarrativeDraftError('ANTHROPIC_API_KEY is not set');
  }
  // Adapter maps the SDK's wider response type down to the blocks used here.
  const anthropic = new Anthropic();
  return {
    messages: {
      create: async (args, options) => {
        const response = await anthropic.messages.create(args, {
          signal: options?.signal,
        });
        const content: NarrativeResponseBlock[] = [];
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
        };
      },
    },
  };
}

const narrativeTool: NarrativeToolDefinition = {
  name: TOOL_NAME,
  description: 'Submit the customer-facing proposal narrative.',
  // Generated from the zod contract; boundary cast widens only the type.
  input_schema: z.toJSONSchema(narrativeSchema) as unknown as Anthropic.Tool.InputSchema,
};

export async function draftNarrative(
  context: NarrativeContext,
  opts: NarrativeOptions = {},
): Promise<NarrativeResult> {
  const client = opts.client ?? defaultClient();
  const recordRun = opts.recordRun ?? recordAgentRun;
  const model = opts.model ?? SONNET_MODEL;
  const runCtx: AgentRunContext = { step: 'draft_narrative', proposalId: opts.proposalId ?? null };

  const messages: NarrativeMessageParam[] = [
    {
      role: 'user',
      content:
        `<scope>\n${JSON.stringify(
          {
            project_summary: context.projectSummary,
            property: context.property,
            line_items: context.lineItems.map((line) => ({
              description: line.description,
              quantity: line.quantity,
              unit: line.unit,
            })),
          },
          null,
          2,
        )}\n</scope>\n\nDraft the proposal narrative and submit it with the ${TOOL_NAME} tool.`,
    },
  ];

  let attempts = 0;
  let totalCostUsd = 0;

  for (attempts = 1; attempts <= MAX_ATTEMPTS; attempts += 1) {
    const startedAt = Date.now();
    let response: NarrativeModelResponse;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: opts.maxTokens ?? 1500,
          system: SYSTEM_PROMPT,
          messages,
          tools: [narrativeTool],
          tool_choice: { type: 'tool', name: TOOL_NAME },
        },
        { signal: opts.signal },
      );
    } catch (err) {
      await recordRun(runCtx, {
        model,
        tokensIn: null,
        tokensOut: null,
        costUsd: 0,
        latencyMs: Date.now() - startedAt,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      break; // deterministic fallback below
    }

    const latencyMs = Date.now() - startedAt;
    const costUsd = estimateMessageCostUsd(model, response.usage.input_tokens, response.usage.output_tokens);
    totalCostUsd += costUsd ?? 0;

    const toolUse = response.content.find(
      (block): block is NarrativeToolUseBlock =>
        block.type === 'tool_use' && block.name === TOOL_NAME,
    );

    const parsed = toolUse ? narrativeSchema.safeParse(toolUse.input) : null;
    const violations: string[] = [];
    if (!toolUse) {
      violations.push(`You did not call the ${TOOL_NAME} tool.`);
    } else if (!parsed?.success) {
      violations.push(
        parsed?.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('\n') ?? 'schema validation failed',
      );
    } else {
      violations.push(...narrativeViolations(parsed.data, context));
    }

    if (toolUse && parsed?.success && violations.length === 0) {
      await recordRun(runCtx, {
        model,
        tokensIn: response.usage.input_tokens,
        tokensOut: response.usage.output_tokens,
        costUsd,
        latencyMs,
        status: 'ok',
      });
      return { narrative: parsed.data, attempts, usedFallback: false, totalCostUsd };
    }

    const canRetry = attempts < MAX_ATTEMPTS;
    await recordRun(runCtx, {
      model,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      costUsd,
      latencyMs,
      status: canRetry ? 'retried' : 'failed',
      error: violations.join(' | ').slice(0, 500),
    });

    if (!canRetry) break;

    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUse?.id ?? 'unknown',
          is_error: true,
          content: `Your narrative was rejected:\n${violations.join('\n')}\n\nFix every issue and submit again with the ${TOOL_NAME} tool.`,
        },
      ],
    });
  }

  return {
    narrative: fallbackNarrative(context),
    attempts,
    usedFallback: true,
    totalCostUsd,
  };
}
