/**
 * Seeds two demo proposals so a reviewer landing on a cold deployment sees a
 * populated dashboard:
 *
 *   1. "Vega backyard" — a fully completed, APPROVED proposal with clean
 *      guardrails, agent cost history and verified evidence (the happy path).
 *   2. "Casa del Sol" — a NEEDS_REVIEW proposal whose two quantity lines are
 *      blocked by G6 (grossly over-quantified: 500 fire pits), so the review
 *      UI shows red rows, blocks and warns immediately.
 *
 * Idempotent: deletes its own rows (keyed by the fixed demo lead ids) before
 * inserting. Requires a migrated, seeded database:
 *
 *   npm run seed:demo
 *
 * Against production:
 *   SUPABASE_URL=https://<proj>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service key> \
 *   npm run seed:demo
 */
import { scriptSupabase } from './lib/supabase';

const LEAD_APPROVED = '55555555-0000-0000-0000-000000000001';
const LEAD_REVIEW = '55555555-0000-0000-0000-000000000002';
const WALK_APPROVED = '55555555-0000-0000-0000-000000000003';
const WALK_REVIEW = '55555555-0000-0000-0000-000000000004';
const PROPOSAL_APPROVED = '55555555-0000-0000-0000-000000000005';
const PROPOSAL_REVIEW = '55555555-0000-0000-0000-000000000006';

const TRANSCRIPT_APPROVED = `walked the backyard. she specifically said pet grass, they've got two goldens.
the paver walkway is about four feet wide, sixty feet give or take, running from the side gate.
and every monsoon the water sits against the patio door, so a french drain along that side,
four inch, maybe fifty feet, tying to a pop-up out front.`;

const TRANSCRIPT_REVIEW = `club site walk. they want two fire pits for the club — fifty of each model so
every gate has one — and brass uplights everywhere along the fence, fifty at least.
numbers came in big; flag this one for the office before anything goes out.`;

async function main(): Promise<void> {
  const db = scriptSupabase();

  // --- clean previous demo rows (reverse dependency order) -----------------
  const oldProposals = await db
    .from('proposals')
    .select('id')
    .in('lead_id', [LEAD_APPROVED, LEAD_REVIEW]);
  const oldIds = (oldProposals.data ?? []).map((row) => row.id);
  if (oldIds.length > 0) {
    await db.from('proposal_line_items').delete().in('proposal_id', oldIds);
    await db.from('guardrail_events').delete().in('proposal_id', oldIds);
    await db.from('agent_runs').delete().in('proposal_id', oldIds);
    await db.from('outbound_events').delete().in('proposal_id', oldIds);
    await db.from('audit_log').delete().in('entity_id', oldIds);
    await db.from('proposals').delete().in('id', oldIds);
  }
  await db.from('site_walks').delete().in('id', [WALK_APPROVED, WALK_REVIEW]);
  await db.from('leads').delete().in('id', [LEAD_APPROVED, LEAD_REVIEW]);

  // --- shared: resolve catalog ids -----------------------------------------
  const skus = ['TF-PET-70', 'PV-CHL-60', 'DR-FR-4', 'FF-PIT-SQ-ML', 'LL-UPL-BRS'];
  const { data: catalog, error: catalogError } = await db
    .from('catalog_items')
    .select('id, sku, unit')
    .in('sku', skus);
  if (catalogError) throw new Error(catalogError.message);
  const bySku = new Map((catalog ?? []).map((row) => [row.sku, row]));

  // ==========================================================================
  // Demo 1 — completed, approved (happy path)
  // ==========================================================================
  const leadA = await db
    .from('leads')
    .insert({
      id: LEAD_APPROVED,
      full_name: 'Marisol Vega',
      phone: '(480) 555-0134',
      email: 'marisol.vega@example.com',
      address: '4317 E Silvercrest Dr',
      city: 'Phoenix',
      source: 'sitewalk',
    })
    .select('id')
    .single();
  if (leadA.error) throw new Error(leadA.error.message);

  const walkA = await db
    .from('site_walks')
    .insert({
      id: WALK_APPROVED,
      lead_id: LEAD_APPROVED,
      input_mode: 'text',
      transcript: TRANSCRIPT_APPROVED,
      transcript_provider: 'manual',
    })
    .select('id')
    .single();
  if (walkA.error) throw new Error(walkA.error.message);

  const approvedAt = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const proposalA = await db
    .from('proposals')
    .insert({
      id: PROPOSAL_APPROVED,
      lead_id: LEAD_APPROVED,
      site_walk_id: WALK_APPROVED,
      status: 'approved',
      subtotal: 15035,
      mobilization_fee: 850,
      contingency: 751.75,
      tax: 640.72,
      total: 17277.47,
      cost_total: 8924.7,
      margin_pct: 48.34,
      narrative: JSON.stringify({
        scope_overview:
          'Your backyard gets pet-grade turf, a cobble paver walkway from the side gate, and a french drain that finally ends the monsoon pooling.',
        whats_included: [
          'Pet-grade turf: 900 sqft, zeolite-ready for the dogs.',
          'Cobble stone walkway: 240 sqft from the side gate to the back door.',
          '4-inch french drain along the fence, daylighted out front.',
        ],
        exclusions: ['Permits and HOA fees unless itemized above', 'Design changes after approval'],
        timeline_sentence:
          'From mobilization to final walkthrough, this project is scheduled for completion in about 3 to 4 weeks.',
      }),
      exclusions: 'Permits and HOA fees unless itemized above',
      approved_by: 'review-ui',
      approved_at: approvedAt,
      step_status: {
        started_at: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
        steps: Object.fromEntries(
          ['transcribe', 'classify', 'extract', 'match', 'price', 'guardrails', 'narrative', 'persist'].map(
            (name) => [name, 'done'],
          ),
        ),
        current: null,
      },
    })
    .select('id')
    .single();
  if (proposalA.error) throw new Error(proposalA.error.message);

  const approvedLines = [
    {
      proposal_id: PROPOSAL_APPROVED,
      catalog_item_id: bySku.get('TF-PET-70')?.id ?? null,
      description: 'pet grass, they have two goldens',
      qty: 900,
      unit: 'sqft',
      // Catalog list price; the 4% volume tier (900 sqft) is recorded
      // separately so review repricing applies it exactly once.
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
    {
      proposal_id: PROPOSAL_APPROVED,
      catalog_item_id: bySku.get('PV-CHL-60')?.id ?? null,
      description: 'paver walkway from the side gate',
      qty: 240,
      unit: 'sqft',
      unit_price: 16.5,
      discount_bps: 0,
      unit_cost: 10.23,
      line_total: 3960,
      match_method: 'lexical',
      match_confidence: 0.88,
      transcript_evidence: 'about four feet wide, sixty feet give or take',
      evidence_verified: true,
      needs_review: false,
      sort_order: 1,
    },
    {
      proposal_id: PROPOSAL_APPROVED,
      catalog_item_id: bySku.get('DR-FR-4')?.id ?? null,
      description: 'french drain along the patio door side',
      qty: 50,
      unit: 'lf',
      unit_price: 46,
      discount_bps: 0,
      unit_cost: 27.6,
      line_total: 2300,
      match_method: 'vector',
      match_confidence: 0.82,
      transcript_evidence: 'every monsoon the water sits against the patio door',
      evidence_verified: true,
      needs_review: false,
      sort_order: 2,
    },
  ];
  const linesA = await db.from('proposal_line_items').insert(approvedLines);
  if (linesA.error) throw new Error(linesA.error.message);

  const agentRunsA = await db.from('agent_runs').insert([
    { proposal_id: PROPOSAL_APPROVED, step: 'transcribe', model: 'whisper-1', tokens_in: null, tokens_out: null, cost_usd: 0.054, latency_ms: 14200, status: 'ok' },
    { proposal_id: PROPOSAL_APPROVED, step: 'classify', model: 'claude-haiku-4-5', tokens_in: 410, tokens_out: 40, cost_usd: 0.00101, latency_ms: 1300, status: 'ok' },
    { proposal_id: PROPOSAL_APPROVED, step: 'extract_scope', model: 'claude-sonnet-4-5', tokens_in: 1450, tokens_out: 520, cost_usd: 0.01215, latency_ms: 8900, status: 'ok' },
    { proposal_id: PROPOSAL_APPROVED, step: 'draft_narrative', model: 'claude-sonnet-4-5', tokens_in: 900, tokens_out: 380, cost_usd: 0.0084, latency_ms: 6100, status: 'ok' },
  ]);
  if (agentRunsA.error) throw new Error(agentRunsA.error.message);

  const guardrailsA = await db.from('guardrail_events').insert(
    [
      ['G1_schema_valid', true], ['G2_evidence_grounded', true], ['G3_catalog_grounded', true],
      ['G4_margin_floor', true], ['G5_total_bounds', true], ['G6_quantity_sanity', true],
      ['G7_uncommitted_items', true], ['G8_cost_ceiling', true], ['G9_wall_clock', true],
    ].map(([rule, passed]) => ({
      proposal_id: PROPOSAL_APPROVED,
      rule: rule as string,
      severity: 'warn',
      passed: passed as boolean,
      detail: { demo: true },
    })),
  );
  if (guardrailsA.error) throw new Error(guardrailsA.error.message);

  // ==========================================================================
  // Demo 2 — needs_review with two blocked (G6 over-quantity) line items
  // ==========================================================================
  const leadB = await db
    .from('leads')
    .insert({
      id: LEAD_REVIEW,
      full_name: 'Casa del Sol Event Club',
      phone: '(602) 555-0177',
      address: '1200 W Clubhouse Ln',
      city: 'Glendale',
      source: 'sitewalk',
    })
    .select('id')
    .single();
  if (leadB.error) throw new Error(leadB.error.message);

  const walkB = await db
    .from('site_walks')
    .insert({
      id: WALK_REVIEW,
      lead_id: LEAD_REVIEW,
      input_mode: 'text',
      transcript: TRANSCRIPT_REVIEW,
      transcript_provider: 'manual',
    })
    .select('id')
    .single();
  if (walkB.error) throw new Error(walkB.error.message);

  const proposalB = await db
    .from('proposals')
    .insert({
      id: PROPOSAL_REVIEW,
      lead_id: LEAD_REVIEW,
      site_walk_id: WALK_REVIEW,
      status: 'needs_review',
      subtotal: 3_897_500,
      mobilization_fee: 0,
      contingency: 194_875,
      tax: 152_531.75,
      total: 4_244_906.75,
      cost_total: 2_264_500,
      margin_pct: 46.65,
      narrative: JSON.stringify({
        scope_overview:
          'Two fire pit installations and perimeter uplighting for the club grounds, pending review of the requested quantities.',
        whats_included: [
          'Gas fire pit (square, match-lit): 500 units as requested.',
          'Brass LED uplights: 500 units along the fence line.',
        ],
        exclusions: ['Permits and HOA fees unless itemized above'],
        timeline_sentence:
          'This project is currently on hold pending quantity review — see the flagged lines.',
      }),
      exclusions: 'Permits and HOA fees unless itemized above',
      step_status: {
        started_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
        steps: Object.fromEntries(
          ['transcribe', 'classify', 'extract', 'match', 'price', 'guardrails', 'narrative', 'persist'].map(
            (name) => [name, 'done'],
          ),
        ),
        current: null,
        error: 'guardrails: G6_quantity_sanity flagged 2 lines',
      },
    })
    .select('id')
    .single();
  if (proposalB.error) throw new Error(proposalB.error.message);

  const reviewLines = [
    {
      proposal_id: PROPOSAL_REVIEW,
      catalog_item_id: bySku.get('FF-PIT-SQ-ML')?.id ?? null,
      description: 'gas fire pit (square, match-lit) — "fifty of each model so every gate has one"',
      qty: 500,
      unit: 'ea',
      unit_price: 7400,
      unit_cost: 4292,
      line_total: 3_700_000,
      match_method: 'hybrid',
      match_confidence: 0.91,
      transcript_evidence: 'two fire pits for the club',
      evidence_verified: true,
      needs_review: true,
      sort_order: 0,
    },
    {
      proposal_id: PROPOSAL_REVIEW,
      catalog_item_id: bySku.get('LL-UPL-BRS')?.id ?? null,
      description: 'brass LED uplights — "fifty at least" along the fence',
      qty: 500,
      unit: 'ea',
      unit_price: 395,
      unit_cost: 237,
      line_total: 197_500,
      match_method: 'lexical',
      match_confidence: 0.76,
      transcript_evidence: 'brass uplights everywhere along the fence, fifty at least',
      evidence_verified: true,
      needs_review: true,
      sort_order: 1,
    },
  ];
  const linesB = await db.from('proposal_line_items').insert(reviewLines);
  if (linesB.error) throw new Error(linesB.error.message);

  const agentRunsB = await db.from('agent_runs').insert([
    { proposal_id: PROPOSAL_REVIEW, step: 'classify', model: 'claude-haiku-4-5', tokens_in: 520, tokens_out: 42, cost_usd: 0.0012, latency_ms: 1400, status: 'ok' },
    { proposal_id: PROPOSAL_REVIEW, step: 'extract_scope', model: 'claude-sonnet-4-5', tokens_in: 1600, tokens_out: 480, cost_usd: 0.0119, latency_ms: 9400, status: 'ok' },
    { proposal_id: PROPOSAL_REVIEW, step: 'draft_narrative', model: 'claude-sonnet-4-5', tokens_in: 940, tokens_out: 350, cost_usd: 0.0081, latency_ms: 5800, status: 'ok' },
  ]);
  if (agentRunsB.error) throw new Error(agentRunsB.error.message);

  const guardrailsB = await db.from('guardrail_events').insert([
    {
      proposal_id: PROPOSAL_REVIEW,
      rule: 'G6_quantity_sanity',
      severity: 'block',
      passed: false,
      detail: {
        multiplier: 4,
        offenders: [
          { line_index: 0, sku: 'FF-PIT-SQ-ML', quantity: 500, max_allowed: 8 },
          { line_index: 1, sku: 'LL-UPL-BRS', quantity: 500, max_allowed: 48 },
        ],
      },
    },
    {
      proposal_id: PROPOSAL_REVIEW,
      rule: 'G5_total_bounds',
      severity: 'warn',
      passed: false,
      detail: { total: 4_244_906.75, reason: 'above_maximum' },
    },
  ]);
  if (guardrailsB.error) throw new Error(guardrailsB.error.message);

  console.log('demo data seeded:');
  console.log('  approved proposal  -> /proposals/' + PROPOSAL_APPROVED);
  console.log('  needs_review (G6)  -> /proposals/' + PROPOSAL_REVIEW);
}

void main();
