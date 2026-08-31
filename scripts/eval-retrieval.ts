/**
 * Retrieval quality harness for catalog matching.
 *
 * Runs 40 hand-written query -> expected-SKU pairs (exact names, colloquial
 * homeowner phrasing, transcription errors) against the four retrieval
 * strategies and reports accuracy@1, accuracy@5 and MRR as a markdown table.
 *
 * The query embeddings are requested in a single batched OpenAI call and
 * reused across strategies. Embedding cost is printed at the end; these runs
 * are audited here rather than in agent_runs because they are offline
 * measurement, not proposal work.
 *
 * Usage:
 *   npm run eval:retrieval                 # all four strategies
 *   npm run eval:retrieval -- --only=lexical,fuzzy   # skip embedding cost
 *
 * Requires .env.local: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) +
 * SUPABASE_SERVICE_ROLE_KEY (+ OPENAI_API_KEY unless --only excludes vector
 * and hybrid).
 */
import OpenAI from 'openai';

import { scriptSupabase } from './lib/supabase';

type Strategy = 'vector' | 'lexical' | 'fuzzy' | 'hybrid';
type PairKind = 'exact' | 'colloquial' | 'transcription';

interface EvalPair {
  query: string;
  expectedSku: string;
  kind: PairKind;
}

// Hand-written pairs. Near-duplicate SKUs (travertine sizes, French-pattern
// grades, turf pile heights, grill sizes, transformers) are probed on purpose.
const EVAL_PAIRS: EvalPair[] = [
  // --- exact names (14) ---
  { query: 'Motorized Louvered Aluminum Pergola', expectedSku: 'PG-LVR-MOT', kind: 'exact' },
  { query: 'Brass Path Light', expectedSku: 'LL-PATH-BRS', kind: 'exact' },
  { query: 'Cast-Stone Urn Fountain', expectedSku: 'WF-URN-CAST', kind: 'exact' },
  { query: 'Outdoor Refrigerator', expectedSku: 'OK-FRIDGE', kind: 'exact' },
  { query: 'Zeolite Pet Infill', expectedSku: 'TF-INFILL-ZEO', kind: 'exact' },
  { query: 'RP Backflow Assembly Install', expectedSku: 'IR-BFLW-RP', kind: 'exact' },
  { query: 'Kool Deck Acrylic Overlay', expectedSku: 'CC-KOOL-OVL', kind: 'exact' },
  { query: 'Saguaro Cactus', expectedSku: 'PT-SAGUARO', kind: 'exact' },
  { query: 'Catch Basin 12 with Grate', expectedSku: 'DR-BASIN-12', kind: 'exact' },
  { query: 'Double Side Burner', expectedSku: 'OK-SDBRN-2', kind: 'exact' },
  { query: 'Pondless Waterfall with Stream', expectedSku: 'WF-PWL-STD', kind: 'exact' },
  { query: 'Brass LED Uplight', expectedSku: 'LL-UPL-BRS', kind: 'exact' },
  { query: 'Wood-Burning Fire Pit', expectedSku: 'FF-PIT-WD', kind: 'exact' },
  { query: 'Class II Aggregate Base', expectedSku: 'GD-AB-CLASS2', kind: 'exact' },

  // --- colloquial phrasing a homeowner would use (13) ---
  { query: 'that stone patio with the fancy pattern, the premium one', expectedSku: 'TRV-IVY-FPP', kind: 'colloquial' },
  { query: 'fake grass for my dogs', expectedSku: 'TF-PET-70', kind: 'colloquial' },
  { query: 'putting green in my backyard', expectedSku: 'TF-PUTT-NYL', kind: 'colloquial' },
  { query: 'somewhere to cook outside with a really big grill', expectedSku: 'OK-GRILL-42', kind: 'colloquial' },
  { query: 'shade thing over the patio that opens and closes', expectedSku: 'PG-LVR-MOT', kind: 'colloquial' },
  { query: 'fire pit that lights itself', expectedSku: 'FF-PIT-SQ-EI', kind: 'colloquial' },
  { query: 'water feature without the pond part', expectedSku: 'WF-PWL-STD', kind: 'colloquial' },
  { query: 'path gravel that gets hard, the gold colored stuff', expectedSku: 'GD-DG-MGD-STB', kind: 'colloquial' },
  { query: 'wall to hold up the hill in my backyard', expectedSku: 'RW-AB-FACE', kind: 'colloquial' },
  { query: 'bench height wall around the fire pit area', expectedSku: 'RW-SW-AB', kind: 'colloquial' },
  { query: 'drain for the driveway so water stops pooling', expectedSku: 'DR-CHAN-5', kind: 'colloquial' },
  { query: 'get water and gas ready for the outdoor kitchen', expectedSku: 'OK-GAS-WTR', kind: 'colloquial' },
  { query: 'help with the HOA paperwork for my project', expectedSku: 'HOA-PKG', kind: 'colloquial' },

  // --- transcription errors from a spoken site walk (13) ---
  { query: 'travertyne pavers ivory', expectedSku: 'TRV-IVY-1624', kind: 'transcription' },
  { query: 'cedar wood pergula attached to the house', expectedSku: 'PG-WD-ATT', kind: 'transcription' },
  { query: 'outside kitchin counter with granite', expectedSku: 'OK-CTR-GRN', kind: 'transcription' },
  { query: 'decomposed grannite pathway', expectedSku: 'GD-DG-MGD', kind: 'transcription' },
  { query: 'retainning wall blocks', expectedSku: 'RW-AB-FACE', kind: 'transcription' },
  { query: 'gas fyr pit square one', expectedSku: 'FF-PIT-SQ-ML', kind: 'transcription' },
  { query: 'artifical turf sixty ounce', expectedSku: 'TF-STD-60', kind: 'transcription' },
  { query: 'smart irragation controller', expectedSku: 'IR-CTRL-SM8', kind: 'transcription' },
  { query: 'low volt transformer 300 watt', expectedSku: 'LL-TR-300', kind: 'transcription' },
  { query: 'concreat demo and haul off', expectedSku: 'DH-CONC-DEM', kind: 'transcription' },
  { query: 'sitting wall by the fire pit', expectedSku: 'RW-SW-AB', kind: 'transcription' },
  { query: 'outdoor firplace in stucco and stone', expectedSku: 'FF-PLC-CST', kind: 'transcription' },
  { query: 'drip irigation zone for the shrubs', expectedSku: 'IR-ZN-DP', kind: 'transcription' },
];

function accuracyAtK(ranked: string[], expected: string, k: number): boolean {
  return ranked.slice(0, k).includes(expected);
}

function reciprocalRank(ranked: string[], expected: string): number {
  const idx = ranked.indexOf(expected);
  return idx === -1 ? 0 : 1 / (idx + 1);
}

interface Metrics {
  acc1: number;
  acc5: number;
  mrr: number;
}

function metricsFor(runs: string[][], pairs: EvalPair[]): Metrics {
  const n = pairs.length;
  return {
    acc1: runs.filter((r, i) => accuracyAtK(r, pairs[i].expectedSku, 1)).length / n,
    acc5: runs.filter((r, i) => accuracyAtK(r, pairs[i].expectedSku, 5)).length / n,
    mrr: runs.reduce((sum, r, i) => sum + reciprocalRank(r, pairs[i].expectedSku), 0) / n,
  };
}

const STRATEGY_LABELS: Record<Strategy, string> = {
  vector: 'vector (cosine, top 10)',
  lexical: 'lexical (ts_rank_cd, top 10)',
  fuzzy: 'fuzzy (pg_trgm, top 10)',
  hybrid: 'hybrid (RRF k=60)',
};

const ALL_STRATEGIES: Strategy[] = ['vector', 'lexical', 'fuzzy', 'hybrid'];

function parseOnlyFlag(): Strategy[] {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return ALL_STRATEGIES;
  const requested = arg
    .slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is Strategy => ALL_STRATEGIES.includes(s as Strategy));
  if (requested.length === 0) {
    console.error('no valid strategies in --only (use vector, lexical, fuzzy, hybrid)');
    process.exit(1);
  }
  return requested;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const strategies = parseOnlyFlag();
  const needsEmbeddings = strategies.includes('vector') || strategies.includes('hybrid');
  const supabase = scriptSupabase();

  let queryEmbeddings: number[][] = [];
  let embedTokens = 0;
  let embedCostUsd = 0;

  if (needsEmbeddings) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(
        'OPENAI_API_KEY missing — required for vector/hybrid. Use --only=lexical,fuzzy to skip embeddings.',
      );
      process.exitCode = 1;
      return;
    }
    const openai = new OpenAI({ apiKey });
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: EVAL_PAIRS.map((pair) => pair.query),
    });
    queryEmbeddings = response.data.map((d) => d.embedding);
    embedTokens = response.usage.total_tokens;
    embedCostUsd = (embedTokens / 1_000_000) * 0.02;
  }

  const runs = new Map<Strategy, string[][]>();

  for (const [pairIndex, pair] of EVAL_PAIRS.entries()) {
    const perStrategy = new Map<Strategy, string[]>();

    if (strategies.includes('vector')) {
      const { data, error } = await supabase.rpc('search_catalog_vector', {
        p_query_embedding: queryEmbeddings[pairIndex],
        p_match_count: 10,
      });
      if (error) throw new Error(`vector rpc failed: ${error.message}`);
      perStrategy.set('vector', (data ?? []).map((row) => String(row.sku)));
    }

    if (strategies.includes('lexical')) {
      const { data, error } = await supabase.rpc('search_catalog_lexical', {
        p_raw_query: pair.query,
        p_match_count: 10,
      });
      if (error) throw new Error(`lexical rpc failed: ${error.message}`);
      perStrategy.set('lexical', (data ?? []).map((row) => String(row.sku)));
    }

    if (strategies.includes('fuzzy')) {
      const { data, error } = await supabase.rpc('search_catalog_fuzzy', {
        p_raw_query: pair.query,
        p_match_count: 10,
      });
      if (error) throw new Error(`fuzzy rpc failed: ${error.message}`);
      perStrategy.set('fuzzy', (data ?? []).map((row) => String(row.sku)));
    }

    if (strategies.includes('hybrid')) {
      const { data, error } = await supabase.rpc('match_catalog_fused', {
        p_query_embedding: queryEmbeddings[pairIndex],
        p_raw_query: pair.query,
        p_match_count: 10,
        p_rrf_k: 60,
        p_strategy_depth: 10,
      });
      if (error) throw new Error(`fused rpc failed: ${error.message}`);
      perStrategy.set('hybrid', (data ?? []).map((row) => String(row.sku)));
    }

    for (const strategy of strategies) {
      runs.set(strategy, [...(runs.get(strategy) ?? []), perStrategy.get(strategy) ?? []]);
    }
  }

  console.log(`\nRetrieval eval — ${EVAL_PAIRS.length} query/expected-SKU pairs\n`);
  console.log('| strategy | acc@1 | acc@5 | MRR |');
  console.log('|---|---:|---:|---:|');
  for (const strategy of strategies) {
    const m = metricsFor(runs.get(strategy)!, EVAL_PAIRS);
    console.log(
      `| ${STRATEGY_LABELS[strategy]} | ${m.acc1.toFixed(3)} (${formatPct(m.acc1)}) | ${m.acc5.toFixed(3)} (${formatPct(m.acc5)}) | ${m.mrr.toFixed(3)} |`,
    );
  }

  const kinds: PairKind[] = ['exact', 'colloquial', 'transcription'];
  console.log('\nPer-kind accuracy@1\n');
  console.log(`| kind | n |${strategies.map((s) => ` ${s} |`).join('')}`);
  console.log(`|---|---:|${strategies.map(() => '---:|').join('')}`);
  for (const kind of kinds) {
    const pairs = EVAL_PAIRS.filter((p) => p.kind === kind);
    const cells = strategies
      .map((s) => {
        const m = metricsFor(
          runs.get(s)!.filter((_, i) => EVAL_PAIRS[i].kind === kind),
          pairs,
        );
        return ` ${m.acc1.toFixed(3)} |`;
      })
      .join('');
    console.log(`| ${kind} | ${pairs.length} |${cells}`);
  }

  if (needsEmbeddings) {
    console.log(
      `\nquery embedding tokens: ${embedTokens}, estimated cost: $${embedCostUsd.toFixed(6)}`,
    );
  }
}

void main();
