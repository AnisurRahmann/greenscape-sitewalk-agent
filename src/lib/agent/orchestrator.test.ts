import { describe, expect, it, vi } from 'vitest';

import { runSitewalkPipeline } from './orchestrator';

// ---------------------------------------------------------------------------
// Fake Supabase: routes the handful of queries the orchestrator makes.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  const CATALOG_ID = '22222222-2222-2222-2222-222222222222';
  const SITE_WALK_ID = '33333333-3333-3333-3333-333333333333';
  const PROPOSAL_ID = '44444444-4444-4444-4444-444444444444';
  const state = {
    walk: {
      id: SITE_WALK_ID,
      lead_id: 'lead-1',
      input_mode: 'text',
      transcript: 'walked the backyard, they want a gas fire pit',
      audio_path: null as string | null,
    },
    agentRunRows: [{ cost_usd: 0.1 }],
    catalogRows: [{ id: CATALOG_ID, materials_ratio: 0.45 }],
    proposalUpdates: [] as Array<Record<string, unknown>>,
    lineItemInserts: [] as Array<Record<string, unknown>>,
    failGuardrailPersist: false,
  };
  const ok = () => Promise.resolve({ error: null });
  const db = {
    from(table: string) {
      if (table === 'site_walks') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { ...state.walk }, error: null }),
            }),
          }),
        };
      }
      if (table === 'proposals') {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: PROPOSAL_ID }, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            state.proposalUpdates.push(payload);
            return { eq: () => ok() };
          },
        };
      }
      if (table === 'agent_runs') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [...state.agentRunRows], error: null }),
          }),
        };
      }
      if (table === 'catalog_items') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: [...state.catalogRows], error: null }),
          }),
        };
      }
      if (table === 'proposal_line_items') {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            state.lineItemInserts.push(...rows);
            return ok();
          },
        };
      }
      if (table === 'guardrail_events') {
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            if (state.failGuardrailPersist) throw new Error('db down');
            void rows;
            return ok();
          },
        };
      }
      throw new Error(`unexpected table in test fake: ${table}`);
    },
  };
  return { state, getSupabaseAdmin: () => db, CATALOG_ID, SITE_WALK_ID, PROPOSAL_ID };
});

const { CATALOG_ID, SITE_WALK_ID, PROPOSAL_ID } = h;

vi.mock('@/lib/db/client', () => ({ getSupabaseAdmin: h.getSupabaseAdmin }));
vi.mock('@/lib/agent-runs', () => ({ recordAgentRun: vi.fn(async () => {}) }));
vi.mock('@/lib/ingest/transcribe', () => ({
  SITEWALK_BUCKET: 'sitewalks',
  transcribeSiteWalk: vi.fn(async () => {}),
}));
vi.mock('@/lib/retrieval/embedQuery', () => ({
  embedQuery: vi.fn(async () => Array.from({ length: 1536 }, () => 0.01)),
}));

const CLASSIFICATION = { is_sitewalk: true, project_type: 'fire pit install', size_band: 'small' };

vi.mock('./classify', () => ({
  classifyTranscript: vi.fn(async () => ({ classification: CLASSIFICATION })),
}));

const EXTRACTION = {
  extraction: {
    project_summary: 'Gas fire pit installation in the backyard.',
    property: { hoa_involved: false, permit_likely: true, access_notes: null },
    customer_signals: { budget_mentioned: null, timeline_mentioned: null, decision_maker_present: true },
    items: [
      {
        raw_phrase: 'they want a gas fire pit',
        normalized_query: 'gas fire pit square',
        quantity: 1,
        unit: 'ea',
        confidence: 'high',
        committed: true,
        evidence: 'they want a gas fire pit',
        evidence_verified: true,
      },
    ],
    open_questions: [],
  },
  attempts: 1,
  totalCostUsd: 0.01,
};

vi.mock('./extractScope', () => ({
  extractScope: vi.fn(async () => EXTRACTION),
  ExtractionFailedError: class ExtractionFailedError extends Error {},
}));

const CANDIDATE = {
  catalogItem: {
    id: CATALOG_ID,
    sku: 'FF-PIT-SQ-ML',
    category: 'Fire Features',
    name: 'Gas Fire Pit — Square 42" Match-Lit',
    description: 'Square gas fire pit',
    unit: 'ea',
    unit_price: 100,
    unit_cost: 55,
    min_qty: 0,
    notes: null,
  },
  fusedScore: 0.049,
  ranks: { vector: 1, lexical: 1, fuzzy: 1 },
  matchMethod: 'hybrid',
  confidence: 0.97,
};

vi.mock('@/lib/retrieval/matchCatalog', () => ({
  matchCatalog: vi.fn(async () => [CANDIDATE]),
}));

const NARRATIVE = {
  scope_overview:
    'Your backyard gets a premium fire feature. The build is handled end to end by our crews. Expect a clean site when we leave.',
  whats_included: ['gas fire pit — 1 ea installed and commissioned'],
  exclusions: ['Gas line permits unless itemized'],
  timeline_sentence: 'About 2 weeks from mobilization to walkthrough.',
};

vi.mock('./draftNarrative', () => ({
  draftNarrative: vi.fn(async () => ({
    narrative: NARRATIVE,
    attempts: 1,
    usedFallback: false,
    totalCostUsd: 0.01,
  })),
}));

import { classifyTranscript } from './classify';
import { extractScope } from './extractScope';
import { draftNarrative } from './draftNarrative';

function resetFixtures() {
  h.state.agentRunRows = [{ cost_usd: 0.1 }];
  h.state.proposalUpdates = [];
  h.state.lineItemInserts = [];
  h.state.walk.transcript = 'walked the backyard, they want a gas fire pit';
  h.state.walk.input_mode = 'text';
  vi.mocked(classifyTranscript).mockClear();
  vi.mocked(extractScope).mockClear();
  vi.mocked(draftNarrative).mockClear();
}

describe('runSitewalkPipeline', () => {
  it('runs every stage and persists the priced proposal', async () => {
    resetFixtures();

    const result = await runSitewalkPipeline(SITE_WALK_ID);
    console.log('DEBUG STEPDOC', JSON.stringify(h.state.proposalUpdates.at(-1)?.step_status));

    expect(result.status).toBe('completed');
    expect(result.proposalId).toBe(PROPOSAL_ID);
    expect(extractScope).toHaveBeenCalledTimes(1);
    expect(draftNarrative).toHaveBeenCalledTimes(1);

    // Final proposal update carries the engine's computed money.
    const finalUpdate = h.state.proposalUpdates.find((u) => 'total' in u) ?? {};
    expect(finalUpdate.total).toBeCloseTo(100 + 850 + 5 + 3.87, 2);
    expect(finalUpdate.cost_total).toBe(55);
    expect(finalUpdate.status).toBe('draft'); // guardrails passed, nothing blocked

    // Line items persisted with retrieval provenance and the catalog
    // snapshot: description is the catalog NAME, the raw spoken phrase
    // stays in transcript_evidence only.
    expect(h.state.lineItemInserts).toHaveLength(1);
    expect(h.state.lineItemInserts[0]?.catalog_item_id).toBe(CATALOG_ID);
    expect(h.state.lineItemInserts[0]?.sku).toBe('FF-PIT-SQ-ML');
    expect(h.state.lineItemInserts[0]?.catalog_name).toBe('Gas Fire Pit — Square 42" Match-Lit');
    expect(h.state.lineItemInserts[0]?.description).toBe('Gas Fire Pit — Square 42" Match-Lit');
    expect(h.state.lineItemInserts[0]?.description).not.toContain('they want a gas fire pit');
    expect(h.state.lineItemInserts[0]?.match_method).toBe('hybrid');
    expect(h.state.lineItemInserts[0]?.transcript_evidence).toBe('they want a gas fire pit');
  });

  it('aborts before Sonnet spend when the transcript is not a site walk', async () => {
    resetFixtures();
    vi.mocked(classifyTranscript).mockResolvedValueOnce({
      classification: { is_sitewalk: false, project_type: 'lunch order', size_band: 'small' },
    });

    const result = await runSitewalkPipeline(SITE_WALK_ID);

    expect(result.status).toBe('aborted');
    expect(result.message).toContain('not a site walk');
    expect(extractScope).not.toHaveBeenCalled();
    // Rejected, with the classification visible in step_status.
    const finalUpdate = h.state.proposalUpdates.at(-1) ?? {};
    expect(finalUpdate.status).toBe('rejected');
    const stepStatus = finalUpdate.step_status as { steps: Record<string, string>; classification?: { project_type: string } };
    expect(stepStatus.steps.extract).toBe('skipped');
    expect(stepStatus.classification?.project_type).toBe('lunch order');
  });

  it('aborts before classify when the cost ceiling is already spent', async () => {
    resetFixtures();
    h.state.agentRunRows = [{ cost_usd: 0.5 }, { cost_usd: 0.4 }];

    const result = await runSitewalkPipeline(SITE_WALK_ID);

    expect(result.status).toBe('aborted');
    expect(result.failedStep).toBe('classify');
    expect(result.message).toContain('cost ceiling');
    expect(classifyTranscript).not.toHaveBeenCalled();
    expect(extractScope).not.toHaveBeenCalled();
  });
});
