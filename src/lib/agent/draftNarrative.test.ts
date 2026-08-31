import { describe, expect, it, vi } from 'vitest';

import type { AgentRunContext, AgentRunInput } from '@/lib/agent-runs';

import {
  draftNarrative,
  findLeakedFigures,
  fallbackNarrative,
  timelineForTotal,
  TOOL_NAME,
  type NarrativeClient,
  type NarrativeContext,
  type NarrativeModelResponse,
  type NarrativeMessageCreateParams,
} from './draftNarrative';

const CONTEXT: NarrativeContext = {
  projectSummary: 'Backyard travertine patio with pergola and outdoor kitchen.',
  property: { hoaInvolved: true, permitLikely: false, accessNotes: null },
  totals: {
    subtotal: 43_549.09,
    mobilizationFee: 0,
    contingency: 2_177.45,
    tax: 1_684.4,
    total: 47_410.94,
  },
  lineItems: [
    { sku: 'TRV-IVY-1624', description: 'ivory travertine paver', quantity: 800, unit: 'sqft' },
    { sku: 'PG-WD-ATT', description: 'cedar wood pergola', quantity: 192, unit: 'sqft' },
  ],
};

const GOOD_NARRATIVE = {
  scope_overview:
    'Your backyard is getting a complete premium transformation. ' +
    'The existing surfaces come out and a new ivory travertine patio goes in. ' +
    'A cedar pergola anchors the space for year-round outdoor living.',
  whats_included: [
    'Ivory travertine paver: 800 sqft of premium stone flooring.',
    'Cedar wood pergola: 192 sqft of shade structure, built to last.',
  ],
  exclusions: ['Permits and HOA fees unless itemized above'],
  timeline_sentence: 'From mobilization to final walkthrough, expect about 3 to 4 weeks.',
};

function modelResponse(input: unknown): NarrativeModelResponse {
  return {
    content: [
      { type: 'text', text: 'Drafting the narrative.' },
      { type: 'tool_use', id: 'toolu_n_1', name: TOOL_NAME, input },
    ],
    usage: { input_tokens: 200, output_tokens: 150 },
  };
}

function stubClient(responses: NarrativeModelResponse[]) {
  const create = vi.fn((_args: NarrativeMessageCreateParams) => {
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra model call in test');
    return Promise.resolve(next);
  });
  const client: NarrativeClient = { messages: { create } };
  return { client, create };
}

function stubRecordRun() {
  return vi.fn(async (_ctx: AgentRunContext, _run: AgentRunInput) => {});
}

describe('timelineForTotal', () => {
  it('uses the client schedule bands', () => {
    expect(timelineForTotal(14_000)).toContain('2 weeks');
    expect(timelineForTotal(19_999.99)).toContain('2 weeks');
    expect(timelineForTotal(20_000)).toContain('3 to 4 weeks');
    expect(timelineForTotal(50_000)).toContain('3 to 4 weeks');
    expect(timelineForTotal(50_000.01)).toContain('5 to 6 weeks');
  });
});

describe('findLeakedFigures', () => {
  it('flags currency figures that are not computed totals', () => {
    const leaked = findLeakedFigures('for about $43,500 you get', [43_549.09]);
    expect(leaked).toEqual(['$43,500']);
  });

  it('allows computed totals including whole-dollar rounding', () => {
    const text = 'the investment is $47,410.94, roughly $47,411 all in';
    expect(findLeakedFigures(text, [47_410.94])).toEqual([]);
  });
});

describe('draftNarrative', () => {
  it('happy path: grounded narrative passes the leakage check', async () => {
    const { client, create } = stubClient([modelResponse(GOOD_NARRATIVE)]);
    const recordRun = stubRecordRun();

    const result = await draftNarrative(CONTEXT, { client, recordRun });

    expect(result.attempts).toBe(1);
    expect(result.usedFallback).toBe(false);
    expect(result.narrative.exclusions).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
    expect(recordRun.mock.calls[0]?.[1].status).toBe('ok');
    expect(recordRun.mock.calls[0]?.[1].costUsd).toBeCloseTo(
      (200 / 1_000_000) * 3 + (150 / 1_000_000) * 15,
      8,
    );
  });

  it('allows a figure that IS a computed total', async () => {
    const citingTotal = {
      ...GOOD_NARRATIVE,
      timeline_sentence: 'Your $47,410.94 project wraps in about 3 to 4 weeks.',
    };
    const { client } = stubClient([modelResponse(citingTotal)]);

    const result = await draftNarrative(CONTEXT, { client, recordRun: stubRecordRun() });
    expect(result.usedFallback).toBe(false);
    expect(result.narrative.timeline_sentence).toContain('$47,410.94');
  });

  it('repairs invented numbers by feeding the violation back', async () => {
    const leaky = {
      ...GOOD_NARRATIVE,
      scope_overview:
        'Your backyard is getting a complete premium transformation. ' +
        'The whole package comes to about $43,500. ' +
        'A cedar pergola anchors the space.',
    };
    const { client, create } = stubClient([modelResponse(leaky), modelResponse(GOOD_NARRATIVE)]);
    const recordRun = stubRecordRun();

    const result = await draftNarrative(CONTEXT, { client, recordRun });

    expect(result.attempts).toBe(2);
    expect(result.usedFallback).toBe(false);

    const secondArgs = create.mock.calls[1]?.[0];
    const toolResult = secondArgs?.messages.at(-1);
    const block = (toolResult?.content as Array<{ type: string; is_error?: boolean; content: string }>)[0];
    expect(block.is_error).toBe(true);
    expect(block.content).toContain('$43,500');
    expect(recordRun.mock.calls.map(([, run]) => run.status)).toEqual(['retried', 'ok']);
  });

  it('falls back to the deterministic template when the model leaks twice', async () => {
    const leaky = {
      ...GOOD_NARRATIVE,
      scope_overview:
        'Your backyard is getting a complete premium transformation. ' +
        'The whole package comes to about $43,500. ' +
        'A cedar pergola anchors the space.',
    };
    const { client } = stubClient([modelResponse(leaky), modelResponse(leaky)]);
    const recordRun = stubRecordRun();

    const result = await draftNarrative(CONTEXT, { client, recordRun });

    expect(result.usedFallback).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.narrative).toEqual(fallbackNarrative(CONTEXT));
    expect(result.narrative.timeline_sentence).toBe(timelineForTotal(CONTEXT.totals.total));
    // Fallback "what's included" derives strictly from the priced line items.
    expect(result.narrative.whats_included[0]).toContain('ivory travertine paver');
    expect(result.narrative.whats_included[0]).toContain('(800 sqft)');
    expect(recordRun.mock.calls.map(([, run]) => run.status)).toEqual(['retried', 'failed']);
  });
});
