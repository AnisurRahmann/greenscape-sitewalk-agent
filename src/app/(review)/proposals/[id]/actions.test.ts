import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  approveProposal,
  commitLineEdit,
  excludeProposalLine,
  setManualPrice,
  type ApproveInput,
} from './actions';
import { ApprovalBlockedError } from '@/lib/review/reprice-proposal';

// ---------------------------------------------------------------------------
// Fake Supabase: routes the queries repriceStoredProposal + approveProposal make.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const PROPOSAL_ID = '44444444-4444-4444-4444-444444444444';
  const CATALOG_ID = '22222222-2222-2222-2222-222222222222';
  const state = {
    proposalUpdates: [] as Array<Record<string, unknown>>,
    auditInserts: [] as Array<Record<string, unknown>>,
    lineUpdates: [] as Array<Record<string, unknown>>,
    correctionInserts: [] as Array<Record<string, unknown>>,
    afterCallbacks: [] as Array<() => unknown>,
    lines: [
      {
        id: 'line-1',
        proposal_id: PROPOSAL_ID,
        catalog_item_id: CATALOG_ID,
        description: 'pet grass, they have two goldens',
        qty: 900,
        unit: 'sqft',
        unit_price: 9.75,
        discount_bps: 400,
        unit_cost: 5.66,
        line_total: 8424,
        match_method: 'hybrid',
        match_confidence: 0.97,
        transcript_evidence: "she specifically said pet grass, they've got two goldens",
        evidence_verified: true,
        needs_review: false,
        sort_order: 0,
      },
    ],
    catalogRows: [{ id: CATALOG_ID, category: 'Artificial Turf', min_qty: 250, materials_ratio: 0.42 }],
    costRows: [{ cost_usd: 0.1 }],
    events: [] as Array<{ rule: string; detail: unknown }>,
  };
  const ok = { data: null, error: null };
  const db = {
    from(table: string) {
      if (table === 'proposal_line_items') {
        const chain = (filters: Array<[string, unknown]> = []) => ({
          eq: (col: string, val: unknown) => chain([...filters, [col, val]]),
          single: async () => {
            const row = state.lines.find((line) =>
              filters.every(([col, val]) => (line as Record<string, unknown>)[col] === val),
            );
            return { data: row ?? null, error: null };
          },
          order: async () => ({ data: state.lines, error: null }),
        });
        return {
          select: () => chain(),
          update: (payload: Record<string, unknown>) => {
            state.lineUpdates.push(payload);
            // Apply the patch so a later reprice sees the persisted state.
            function eq(filters: Array<[string, unknown]> = []) {
              return {
                eq: (col: string, val: unknown) => eq([...filters, [col, val]]),
                then: (res: (v: { data: null; error: null }) => unknown) => {
                  for (const line of state.lines) {
                    if (
                      filters.every(([col, val]) => (line as Record<string, unknown>)[col] === val)
                    ) {
                      Object.assign(line, payload);
                    }
                  }
                  return res(ok);
                },
              };
            }
            return { eq: () => eq() };
          },
        };
      }
      if (table === 'corrections') {
        return {
          insert: (row: Record<string, unknown>) => {
            state.correctionInserts.push(row);
            return async () => ok;
          },
        };
      }
      if (table === 'catalog_items') {
        return {
          select: () => ({
            in: async () => ({ data: state.catalogRows, error: null }),
          }),
        };
      }
      if (table === 'agent_runs') {
        return {
          select: () => ({
            eq: async () => ({ data: state.costRows, error: null }),
          }),
        };
      }
      if (table === 'guardrail_events') {
        return {
          select: () => ({
            eq: async () => ({ data: state.events, error: null }),
          }),
        };
      }
      if (table === 'proposals') {
        return {
          update: (payload: Record<string, unknown>) => {
            state.proposalUpdates.push(payload);
            return { eq: async () => ok };
          },
        };
      }
      if (table === 'audit_log') {
        return {
          insert: (row: Record<string, unknown>) => {
            state.auditInserts.push(row);
            return async () => ok;
          },
        };
      }
      throw new Error(`unexpected table in test fake: ${table}`);
    },
  };
  return { state, getSupabaseAdmin: () => db, PROPOSAL_ID, CATALOG_ID };
});

vi.mock('@/lib/db/client', () => ({ getSupabaseAdmin: h.getSupabaseAdmin }));
vi.mock('@/lib/auth/require-session', () => ({ requireSession: vi.fn(async () => {}) }));
vi.mock('next/server', () => ({
  after: (callback: () => unknown) => h.state.afterCallbacks.push(callback),
}));
vi.mock('@/lib/dispatch', () => ({ dispatchProposal: vi.fn(async () => ({ channels: [] })) }));
vi.mock('@/lib/dispatch/proposal-pdf', () => ({ ensureProposalPdf: vi.fn(async () => ({})) }));

const { PROPOSAL_ID } = h;

/** A hostile client's payload: every total forged to one cent. */
const FORGED_TOTALS = {
  subtotal: 0.01,
  mobilizationFee: 0.01,
  contingency: 0.01,
  tax: 0.01,
  total: 0.01,
  marginPct: 99,
};

describe('approveProposal — server-authoritative repricing', () => {
  beforeEach(() => {
    h.state.proposalUpdates = [];
    h.state.auditInserts = [];
    h.state.afterCallbacks = [];
  });

  it('ignores a forged totals payload and persists the engine-computed totals', async () => {
    const forged = { proposalId: PROPOSAL_ID, totals: FORGED_TOTALS } as unknown as ApproveInput;
    const outcome = await approveProposal(forged);
    expect(outcome.ok).toBe(true);

    // TF-PET-70 at 900 sqft: 9.75 list, 4% tier, priced by the server.
    const update = h.state.proposalUpdates[0]!;
    expect(update.status).toBe('approved');
    expect(update.subtotal).toBe(8_424);
    expect(update.total).toBe(9_999.47);
    expect(update.total).not.toBe(FORGED_TOTALS.total);
    expect(update.margin_pct).toBeGreaterThan(0);

    const audit = h.state.auditInserts[0]!;
    expect(audit.after).toMatchObject({ totals_source: 'server_repriced' });
  });

  it('refuses with a typed error and persists nothing when a rule blocks', async () => {
    // A 5.66 -> 9.50 unit cost sinks the margin below the 30% floor (G4).
    h.state.lines[0]!.unit_cost = 9.5;
    const forged = { proposalId: PROPOSAL_ID, totals: FORGED_TOTALS } as unknown as ApproveInput;

    const error = await approveProposal(forged).then(
      () => {
        throw new Error('expected the approval to be blocked');
      },
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(ApprovalBlockedError);
    expect((error as ApprovalBlockedError).blockedBy).toEqual(['G4_margin_floor']);

    expect(h.state.proposalUpdates).toHaveLength(0);
    expect(h.state.auditInserts).toHaveLength(0);
    expect(h.state.afterCallbacks).toHaveLength(0);
  });

  it('blocks with no priced items when every line has been excluded', async () => {
    // Soft-deleting every line prices the proposal to zero — G4 must block
    // on 'no priced items', not divide by zero.
    h.state.lines = h.state.lines.map((line) => ({ ...line, excluded: true }));
    const outcome = await approveProposal({ proposalId: PROPOSAL_ID }).then(
      () => {
        throw new Error('expected the approval to be blocked');
      },
      (err: unknown) => err,
    );
    expect(outcome).toBeInstanceOf(ApprovalBlockedError);
    expect((outcome as ApprovalBlockedError).blockedBy).toEqual(['G4_margin_floor']);

    expect(h.state.proposalUpdates).toHaveLength(0);
    expect(h.state.afterCallbacks).toHaveLength(0);
  });
});

describe('corrections — labelled training signal', () => {
  const baseLine = { ...h.state.lines[0]! };

  beforeEach(() => {
    h.state.lines = [{ ...baseLine }];
    h.state.proposalUpdates = [];
    h.state.auditInserts = [];
    h.state.lineUpdates = [];
    h.state.correctionInserts = [];
    h.state.afterCallbacks = [];
  });

  it('commitLineEdit writes a qty correction alongside the audit row', async () => {
    const outcome = await commitLineEdit({
      lineId: 'line-1',
      proposalId: PROPOSAL_ID,
      field: 'quantity',
      before: 900,
      after: 400,
    });
    expect(outcome.ok).toBe(true);

    expect(h.state.auditInserts).toHaveLength(1);
    expect(h.state.correctionInserts).toHaveLength(1);
    const correction = h.state.correctionInserts[0]!;
    expect(correction.correction_type).toBe('qty');
    expect(correction.before).toMatchObject({ quantity: 900 });
    expect(correction.after).toMatchObject({ quantity: 400 });
    // Training signal carries the retrieval context of the original match.
    expect(String(correction.original_query)).toContain('pet grass');
    expect(correction.match_confidence_at_time).toBe(0.97);
  });

  it('labels a unit-price edit as a price correction', async () => {
    await commitLineEdit({
      lineId: 'line-1',
      proposalId: PROPOSAL_ID,
      field: 'unit_price',
      before: 9.75,
      after: 11,
    });
    expect(h.state.correctionInserts[0]?.correction_type).toBe('price');
    expect(h.state.correctionInserts[0]?.before).toMatchObject({ unit_price: 9.75 });
  });

  it('excludeProposalLine writes a remove correction with the required reason', async () => {
    const refused = await excludeProposalLine({
      proposalId: PROPOSAL_ID,
      lineId: 'line-1',
      reason: '   ',
    });
    expect(refused.ok).toBe(false);
    expect(h.state.correctionInserts).toHaveLength(0);
    expect(h.state.lineUpdates).toHaveLength(0);

    const outcome = await excludeProposalLine({
      proposalId: PROPOSAL_ID,
      lineId: 'line-1',
      reason: 'duplicate scope',
    });
    expect(outcome.ok).toBe(true);
    expect(h.state.lineUpdates[0]).toMatchObject({ excluded: true, excluded_reason: 'duplicate scope' });
    expect(h.state.auditInserts[0]).toMatchObject({ action: 'line_item.excluded' });
    expect(h.state.correctionInserts).toHaveLength(1);
    const correction = h.state.correctionInserts[0]!;
    expect(correction.correction_type).toBe('remove');
    expect(correction.after).toMatchObject({ excluded: true, reason: 'duplicate scope' });
    expect(String(correction.original_query)).toContain('pet grass');
  });
});

describe('manual-price escape hatch', () => {
  // A proposal with a single unmatched line: no price, no cost, G3 blocks.
  const UNMATCHED_LINE = {
    id: 'line-1',
    proposal_id: PROPOSAL_ID,
    catalog_item_id: null,
    description: '[Needs review — no catalog match]: pet grass 900 sqft',
    qty: 50,
    unit: 'sqft',
    unit_price: 0,
    discount_bps: 0,
    unit_cost: 0,
    line_total: 0,
    match_method: 'unmatched',
    match_confidence: null,
    transcript_evidence: 'pet grass for the two goldens, nine hundred square',
    evidence_verified: true,
    needs_review: true,
    sort_order: 0,
  };

  beforeEach(() => {
    h.state.lines = [{ ...UNMATCHED_LINE } as unknown as (typeof h.state.lines)[number]];
    h.state.proposalUpdates = [];
    h.state.auditInserts = [];
    h.state.lineUpdates = [];
    h.state.correctionInserts = [];
    h.state.afterCallbacks = [];
  });

  it('cannot be approved while the line is unmatched', async () => {
    const outcome = await approveProposal({ proposalId: PROPOSAL_ID }).then(
      () => {
        throw new Error('expected the approval to be blocked');
      },
      (err: unknown) => err,
    );
    expect(outcome).toBeInstanceOf(ApprovalBlockedError);
    expect((outcome as ApprovalBlockedError).blockedBy).toContain('G3_catalog_grounded');
  });

  it('a manual price with unit cost clears G3 and approval recomputes totals', async () => {
    const priced = await setManualPrice({
      proposalId: PROPOSAL_ID,
      lineId: 'line-1',
      unitPrice: 100,
      unitCost: 55,
    });
    expect(priced.ok).toBe(true);
    // The reviewer-only marker is stripped from the customer-facing description.
    expect(priced.description).toBe('pet grass 900 sqft');
    expect(h.state.correctionInserts[0]?.correction_type).toBe('add');
    expect(String(h.state.correctionInserts[0]?.original_query)).toContain('pet grass');
    expect(h.state.auditInserts[0]?.action).toBe('line_item.manual_price');

    const outcome = await approveProposal({ proposalId: PROPOSAL_ID });
    expect(outcome.ok).toBe(true);

    // 50 sqft x $100 = $5,000 subtotal; <= $40k so $850 mobilization;
    // 5% contingency = $250; 45% materials = $2,250 x 8.6% tax = $193.50.
    const update = h.state.proposalUpdates[0]!;
    expect(update.subtotal).toBe(5_000);
    expect(update.total).toBe(5_000 + 850 + 250 + 193.5);
    // Cost 50 x $55 = $2,750 -> margin is real, not the meaningless 100%.
    expect(update.margin_pct).toBeCloseTo(56.3, 1);
  });

  it('clearing the price reverts to unmatched and re-blocks approval', async () => {
    h.state.lines = [
      {
        ...UNMATCHED_LINE,
        match_method: 'manual',
        unit_price: 100,
        unit_cost: 55,
        needs_review: false,
        description: 'pet grass 900 sqft',
      } as unknown as (typeof h.state.lines)[number],
    ];
    const cleared = await setManualPrice({
      proposalId: PROPOSAL_ID,
      lineId: 'line-1',
      unitPrice: 0,
      unitCost: 0,
    });
    expect(cleared.ok).toBe(true);
    expect(h.state.lines[0]?.match_method).toBe('unmatched');
    expect(h.state.lines[0]?.unit_price).toBe(0);
    expect(h.state.correctionInserts[0]?.correction_type).toBe('remove');

    const outcome = await approveProposal({ proposalId: PROPOSAL_ID }).then(
      () => {
        throw new Error('expected the approval to be blocked');
      },
      (err: unknown) => err,
    );
    expect(outcome).toBeInstanceOf(ApprovalBlockedError);
    expect((outcome as ApprovalBlockedError).blockedBy).toContain('G3_catalog_grounded');
  });
});
