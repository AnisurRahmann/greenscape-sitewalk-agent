import { beforeEach, describe, expect, it, vi } from 'vitest';

import { approveProposal, type ApproveInput } from './actions';
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
        return {
          select: () => ({
            eq: () => ({
              order: async () => ({ data: state.lines, error: null }),
            }),
          }),
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
});
