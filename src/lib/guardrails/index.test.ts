import { describe, expect, it, vi } from 'vitest';

import {
  g1SchemaValid,
  g2EvidenceGrounded,
  g3CatalogGrounded,
  g4MarginFloor,
  g5TotalBounds,
  g6QuantitySanity,
  g7UncommittedItems,
  g8CostCeiling,
  g9WallClock,
  runGuardrails,
  type GuardrailContext,
  type GuardrailLineItem,
  type GuardrailResult,
} from './index';

const CATALOG_ID = '11111111-1111-1111-1111-111111111111';

function line(overrides: Partial<GuardrailLineItem> = {}): GuardrailLineItem {
  return {
    sku: 'FF-PIT-SQ-ML',
    catalogItemId: CATALOG_ID,
    description: 'gas fire pit',
    category: 'Fire Features',
    quantity: 1,
    lineTotal: 7_400,
    matchConfidence: 0.95,
    committed: true,
    ...overrides,
  };
}

function context(overrides: Partial<GuardrailContext> = {}): GuardrailContext {
  return {
    proposalId: 'p-test-1',
    extraction: {
      schemaValid: true,
      retryCount: 0,
      items: [{ rawPhrase: 'gas fire pit', committed: true, evidenceVerified: true }],
    },
    proposal: {
      total: 45_000,
      marginPct: 38,
      lineItems: [line()],
    },
    validCatalogIds: new Set([CATALOG_ID]),
    agentRunCostUsd: 0.42,
    elapsedMs: 90_000,
    ...overrides,
  };
}

describe('G1 schema_valid', () => {
  it('passes when extraction parsed within the retry budget', () => {
    const result = g1SchemaValid({ schemaValid: true, retryCount: 2, items: [] });
    expect(result.passed).toBe(true);
  });

  it('blocks when the extraction never validated (or budget blown)', () => {
    expect(g1SchemaValid({ schemaValid: false, retryCount: 3, items: [] }).passed).toBe(false);
    expect(g1SchemaValid({ schemaValid: true, retryCount: 3, items: [] }).passed).toBe(false);
  });
});

describe('G2 evidence_grounded', () => {
  it('passes when every item is verified', () => {
    const result = g2EvidenceGrounded([
      { rawPhrase: 'fire pit', committed: true, evidenceVerified: true },
      { rawPhrase: 'travertine', committed: true, evidenceVerified: true },
    ]);
    expect(result.passed).toBe(true);
  });

  it('blocks when any item lacks verified evidence', () => {
    const result = g2EvidenceGrounded([
      { rawPhrase: 'fire pit', committed: true, evidenceVerified: true },
      { rawPhrase: 'invented gazebo', committed: true, evidenceVerified: false },
    ]);
    expect(result.severity).toBe('block');
    expect(result.passed).toBe(false);
    expect(result.detail.unverified).toHaveLength(1);
  });
});

describe('G3 catalog_grounded', () => {
  const ids = new Set([CATALOG_ID]);

  it('passes when every line resolves to a real catalog item', () => {
    const result = g3CatalogGrounded([line()], ids);
    expect(result.passed).toBe(true);
    expect(result.detail.unmatched_count).toBe(0);
  });

  it('blocks on a dangling catalog reference', () => {
    const result = g3CatalogGrounded([line({ catalogItemId: 'nope' })], ids);
    expect(result.severity).toBe('block');
    expect(result.passed).toBe(false);
  });

  it('blocks on unmatched (unpriced) lines until a human prices them', () => {
    const result = g3CatalogGrounded([line({ catalogItemId: null, matchMethod: 'unmatched' })], ids);
    expect(result.severity).toBe('block');
    expect(result.passed).toBe(false);
    expect(result.detail.unmatched_count).toBe(1);
    expect(result.detail.reason).toBe('unpriced_lines_present');
    expect(result.detail.forces_needs_review).toBe(true);
  });

  it('passes a line the reviewer priced manually, even without a catalog item', () => {
    const result = g3CatalogGrounded([line({ catalogItemId: null, matchMethod: 'manual' })], ids);
    expect(result.passed).toBe(true);
  });
});

describe('G4 margin_floor', () => {
  it('passes at and above the 30% floor', () => {
    expect(g4MarginFloor(30, 45_000).passed).toBe(true);
    expect(g4MarginFloor(38.5, 45_000).passed).toBe(true);
  });

  it('blocks below the floor', () => {
    const result = g4MarginFloor(29.9, 45_000);
    expect(result.passed).toBe(false);
    expect(result.detail.margin_pct).toBe(29.9);
  });

  it('blocks a zero total as no_priced_items instead of dividing by zero', () => {
    for (const marginPct of [0, NaN]) {
      const result = g4MarginFloor(marginPct, 0);
      expect(result.severity).toBe('block');
      expect(result.passed).toBe(false);
      expect(result.detail.reason).toBe('no_priced_items');
      expect(result.detail).not.toHaveProperty('margin_pct');
    }
  });
});

describe('G5 total_bounds', () => {
  it('passes within the inclusive $8,000..$120,000 range', () => {
    expect(g5TotalBounds(8_000).passed).toBe(true);
    expect(g5TotalBounds(45_000).passed).toBe(true);
    expect(g5TotalBounds(120_000).passed).toBe(true);
  });

  it('warns below the range with a reason', () => {
    const result = g5TotalBounds(7_999);
    expect(result.severity).toBe('warn');
    expect(result.passed).toBe(false);
    expect(result.detail.reason).toBe('below_minimum');
  });

  it('warns above the range with a reason', () => {
    const result = g5TotalBounds(120_001);
    expect(result.passed).toBe(false);
    expect(result.detail.reason).toBe('above_maximum');
  });
});

describe('G6 quantity_sanity', () => {
  it('passes at or under 4x the category P90', () => {
    // Fire Features P90 = 2, so up to 8 units is sane.
    expect(g6QuantitySanity([line({ quantity: 8 })]).passed).toBe(true);
  });

  it('blocks past 4x the category P90 and names the offending line', () => {
    const result = g6QuantitySanity([line({ quantity: 9 })]);
    expect(result.severity).toBe('block');
    expect(result.passed).toBe(false);
    expect(result.lineIndex).toBe(0);
    expect(result.detail.offenders).toHaveLength(1);
  });

  it('passes categories without history with a note', () => {
    const result = g6QuantitySanity([
      line({ category: 'Mystery Category', quantity: 999_999 }),
    ]);
    expect(result.passed).toBe(true);
    expect(result.detail.categories_without_history).toContain('Mystery Category');
  });
});

describe('G7 uncommitted_items', () => {
  it('passes when uncommitted items sit at $0 as optional add-ons', () => {
    const result = g7UncommittedItems([
      line(),
      line({ catalogItemId: null, lineTotal: 0, committed: false, description: 'ramada someday' }),
    ]);
    expect(result.passed).toBe(true);
    expect(result.detail.optional_add_ons).toHaveLength(1);
  });

  it('blocks when an uncommitted item leaked into the total', () => {
    const result = g7UncommittedItems([
      line({ lineTotal: 2_850, committed: false }),
    ]);
    expect(result.severity).toBe('block');
    expect(result.passed).toBe(false);
    expect(result.detail.leaked_into_total).toHaveLength(1);
  });
});

describe('G8 cost_ceiling', () => {
  it('passes under $0.75', () => {
    expect(g8CostCeiling(0.42).passed).toBe(true);
  });

  it('blocks at or above $0.75', () => {
    expect(g8CostCeiling(0.75).passed).toBe(false);
    expect(g8CostCeiling(0.9).passed).toBe(false);
  });
});

describe('G9 wall_clock', () => {
  it('passes at or under the 120s limit', () => {
    expect(g9WallClock(90_000).passed).toBe(true);
    expect(g9WallClock(120_000).passed).toBe(true);
  });

  it('blocks past the limit', () => {
    const result = g9WallClock(120_001);
    expect(result.passed).toBe(false);
  });
});

describe('runGuardrails', () => {
  it('persists all nine events and passes a clean proposal', async () => {
    const saveEvents = vi.fn(
      async (_proposalId: string, _results: GuardrailResult[]) => {},
    );
    const verdict = await runGuardrails(context(), { saveEvents });

    expect(verdict.status).toBe('passed');
    expect(verdict.proposalStatus).toBeNull();
    expect(verdict.results).toHaveLength(9);
    expect(verdict.blocking).toHaveLength(0);
    expect(saveEvents).toHaveBeenCalledTimes(1);
    expect(saveEvents.mock.calls[0]?.[1]).toHaveLength(9);
    expect(verdict.results.map((r) => r.rule)).toContain('G4_margin_floor');
  });

  it('routes a blocking failure to needs_review with inline rules', async () => {
    const ctx = context({
      proposal: {
        total: 45_000,
        marginPct: 12,
        lineItems: [line({ quantity: 999, lineTotal: 45_000 })],
      },
    });
    const saveEvents = vi.fn(async () => {});
    const verdict = await runGuardrails(ctx, { saveEvents });

    expect(verdict.status).toBe('needs_review');
    expect(verdict.proposalStatus).toBe('needs_review');
    expect(verdict.blocking.map((r) => r.rule)).toContain('G4_margin_floor');
    expect(verdict.blocking.map((r) => r.rule)).toContain('G6_quantity_sanity');
    // The quantity failure is attached to line 0 for inline UI display.
    expect(verdict.inlineByLine[0]).toContain('G6_quantity_sanity');
    // Persistence happens even for failing runs.
    expect(saveEvents).toHaveBeenCalled();
  });

  it('does not gate on warns alone', async () => {
    // Total 7,999 trips only the advisory G5 total_bounds warn.
    const ctx = context({
      proposal: {
        total: 7_999,
        marginPct: 38,
        lineItems: [line()],
      },
    });
    const verdict = await runGuardrails(ctx);

    expect(verdict.status).toBe('passed');
    expect(verdict.proposalStatus).toBeNull();
    expect(verdict.warns.map((r) => r.rule)).toContain('G5_total_bounds');
  });

  it('routes an unmatched line to needs_review as a G3 block', async () => {
    const ctx = context({
      proposal: {
        total: 45_000,
        marginPct: 38,
        lineItems: [line(), line({ catalogItemId: null, matchMethod: 'unmatched', lineTotal: 0 })],
      },
    });
    const verdict = await runGuardrails(ctx);

    expect(verdict.status).toBe('needs_review');
    expect(verdict.proposalStatus).toBe('needs_review');
    expect(verdict.blocking.map((r) => r.rule)).toContain('G3_catalog_grounded');
  });

  it('aborts when the cost ceiling is exceeded', async () => {
    const verdict = await runGuardrails(context({ agentRunCostUsd: 0.9 }));
    expect(verdict.aborted).toBe(true);
    expect(verdict.status).toBe('aborted');
    expect(verdict.proposalStatus).toBe('needs_review');
  });

  it('aborts when the wall-clock dead-man switch trips', async () => {
    const verdict = await runGuardrails(context({ elapsedMs: 121_000 }));
    expect(verdict.aborted).toBe(true);
    expect(verdict.status).toBe('aborted');
  });

  it('returns the verdict even when persisting fails', async () => {
    const saveEvents = vi.fn(async () => {
      throw new Error('db down');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const verdict = await runGuardrails(context(), { saveEvents });

    expect(verdict.status).toBe('passed');
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
