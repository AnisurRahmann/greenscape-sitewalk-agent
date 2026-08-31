import { vi, describe, it, expect } from 'vitest';

import type { AgentRunContext, AgentRunInput } from '@/lib/agent-runs';

import {
  ExtractionFailedError,
  extractScope,
  TOOL_NAME,
  type ScopeExtractionClient,
  type ScopeMessageCreateParams,
  type ScopeModelResponse,
} from './extractScope';

const TRANSCRIPT =
  'walked the backyard today. mrs. vega wants the ivory travertine paver over the whole patio, thirty by thirty. ' +
  'she asked about a fire pit but said maybe next year. hoa approval needed, came from the arc committee.';

const VALID_EXTRACTION = {
  project_summary: 'Backyard travertine patio replacement; fire pit deferred to a future phase.',
  property: { hoa_involved: true, permit_likely: false, access_notes: null },
  customer_signals: {
    budget_mentioned: null,
    timeline_mentioned: null,
    decision_maker_present: true,
  },
  items: [
    {
      raw_phrase: 'wants the ivory travertine paver over the whole patio',
      normalized_query: 'ivory travertine paver',
      quantity: 900,
      unit: 'sqft',
      confidence: 'high',
      committed: true,
      evidence: 'ivory travertine paver over the whole patio, thirty by thirty',
    },
    {
      raw_phrase: 'she asked about a fire pit but said maybe next year',
      normalized_query: 'fire pit',
      quantity: null,
      unit: 'unknown',
      confidence: 'low',
      committed: false,
      evidence: 'she asked about a fire pit but said maybe next year',
    },
  ],
  open_questions: [],
};

function modelResponse(input: unknown): ScopeModelResponse {
  return {
    content: [
      { type: 'text', text: 'Extracting scope from the transcript.' },
      { type: 'tool_use', id: 'toolu_test_1', name: TOOL_NAME, input },
    ],
    usage: { input_tokens: 120, output_tokens: 80 },
    stop_reason: 'tool_use',
  };
}

function missingCommitted(input: unknown): unknown {
  // Simulates the model omitting a required field: every item loses `committed`.
  const draft = input as typeof VALID_EXTRACTION;
  return {
    ...draft,
    items: draft.items.map(({ committed: _committed, ...rest }) => rest),
  };
}

function stubClient(responses: ScopeModelResponse[]) {
  const create = vi.fn((_args: ScopeMessageCreateParams) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra model call in test');
    return Promise.resolve(next);
  });
  const client: ScopeExtractionClient = { messages: { create } };
  return { client, create };
}

function stubRecordRun() {
  return vi.fn(async (_ctx: AgentRunContext, _run: AgentRunInput) => {});
}

describe('extractScope', () => {
  it('happy path: parses a valid tool submission and verifies evidence', async () => {
    const { client, create } = stubClient([modelResponse(VALID_EXTRACTION)]);
    const recordRun = stubRecordRun();

    const result = await extractScope(TRANSCRIPT, { client, recordRun });

    expect(result.attempts).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.extraction.items).toHaveLength(2);
    expect(result.extraction.items.every((item) => item.evidence_verified)).toBe(true);
    expect(result.extraction.items[0]?.committed).toBe(true);
    expect(result.extraction.items[1]?.committed).toBe(false);
    expect(result.extraction.property.hoa_involved).toBe(true);

    // Rule 4: one audited run, real token counts, cost from the pricing table
    // (claude-sonnet-4-5: 3 in / 15 out per MTok -> 120/1e6*3 + 80/1e6*15).
    expect(recordRun).toHaveBeenCalledTimes(1);
    const [ctx, run] = recordRun.mock.calls[0] ?? [];
    expect(ctx?.step).toBe('extract_scope');
    expect(run?.status).toBe('ok');
    expect(run?.tokensIn).toBe(120);
    expect(run?.tokensOut).toBe(80);
    expect(run?.costUsd).toBeCloseTo(0.00156, 6);
    expect(result.totalCostUsd).toBeCloseTo(0.00156, 6);

    // Tool-forced call
    const args = create.mock.calls[0]?.[0];
    expect(args?.tool_choice).toEqual({ type: 'tool', name: TOOL_NAME });
    expect(args?.model).toBe('claude-sonnet-4-5');
  });

  it('repairs a schema violation by feeding the validation error back', async () => {
    const { client, create } = stubClient([
      modelResponse(missingCommitted(VALID_EXTRACTION)),
      modelResponse(VALID_EXTRACTION),
    ]);
    const recordRun = stubRecordRun();

    const result = await extractScope(TRANSCRIPT, { client, recordRun });

    expect(result.attempts).toBe(2);
    expect(result.extraction.items[0]?.committed).toBe(true);

    // The retry conversation carries the assistant tool_use, then an error
    // tool_result naming the broken field.
    const secondArgs = create.mock.calls[1]?.[0];
    expect(secondArgs?.messages).toHaveLength(3);
    const toolResult = secondArgs?.messages.at(-1);
    expect(Array.isArray(toolResult?.content)).toBe(true);
    const block = (toolResult?.content as Array<{ type: string; is_error?: boolean; content: string }>)[0];
    expect(block.type).toBe('tool_result');
    expect(block.is_error).toBe(true);
    expect(block.content).toContain('committed');

    expect(recordRun.mock.calls.map(([, run]) => run.status)).toEqual(['retried', 'ok']);
  });

  it('flags hallucinated evidence instead of throwing', async () => {
    const hallucinated = {
      ...VALID_EXTRACTION,
      items: [
        VALID_EXTRACTION.items[0],
        { ...VALID_EXTRACTION.items[1], evidence: 'she signed up for granite countertops and a sport court' },
      ],
    };
    const { client } = stubClient([modelResponse(hallucinated)]);
    const recordRun = stubRecordRun();

    const result = await extractScope(TRANSCRIPT, { client, recordRun });

    expect(result.attempts).toBe(1);
    expect(result.extraction.items[0]?.evidence_verified).toBe(true);
    expect(result.extraction.items[1]?.evidence_verified).toBe(false);
    expect(recordRun.mock.calls[0]?.[1].status).toBe('ok');
  });

  it('aborts on an empty transcript without calling the model', async () => {
    const { client, create } = stubClient([]);
    const recordRun = stubRecordRun();

    await expect(extractScope('   ', { client, recordRun })).rejects.toBeInstanceOf(
      ExtractionFailedError,
    );

    expect(create).not.toHaveBeenCalled();
    expect(recordRun).toHaveBeenCalledTimes(1);
    expect(recordRun.mock.calls[0]?.[1].status).toBe('aborted');
  });

  it('fails hard after the initial call plus two repair retries', async () => {
    const bad = missingCommitted(VALID_EXTRACTION);
    const { client, create } = stubClient([
      modelResponse(bad),
      modelResponse(bad),
      modelResponse(bad),
    ]);
    const recordRun = stubRecordRun();

    const error = await extractScope(TRANSCRIPT, { client, recordRun }).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(ExtractionFailedError);
    if (error instanceof ExtractionFailedError) {
      expect(error.attempts).toBe(3);
      expect(error.lastError).toContain('committed');
    }
    expect(create).toHaveBeenCalledTimes(3);
    expect(recordRun.mock.calls.map(([, run]) => run.status)).toEqual(['retried', 'retried', 'failed']);
  });
});
