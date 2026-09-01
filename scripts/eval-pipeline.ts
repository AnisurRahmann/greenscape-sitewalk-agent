/**
 * Four-variant ablation over the golden set (evals/golden/):
 *
 *   A. single-shot  — one Sonnet call with the whole catalog in context,
 *                     asked to emit the priced proposal (does its own arithmetic).
 *   B. extraction + vector-only matching + deterministic pricing.
 *   C. extraction + hybrid RRF matching + deterministic pricing.
 *   D. C plus the full guardrail layer (rules re-run over the priced lines).
 *
 * Reported per variant: scope item recall, scope item precision, SKU match
 * accuracy@1, pricing error rate, hallucinated line rate, false-flag rate
 * (headline — the cost of over-caution), median latency and cost per proposal.
 * Metric definitions live in evals/metrics.ts.
 *
 * Cost accounting: A = Sonnet usage. B/C/D = Sonnet extraction (real usage) +
 * text-embedding-3-small query embeddings (chars/4 estimate). Narrative and
 * dispatch are excluded from every variant equally.
 *
 * Usage:
 *   npm run eval:pipeline                # all variants (needs keys + migrated DB)
 *   npm run eval:pipeline -- --list      # print the loaded golden set, no LLM
 *   npm run eval:pipeline -- --only=A,C
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { evaluateRules } from '../src/lib/guardrails/rules';
import { priceProposal } from '../src/lib/pricing/engine';
import type { MatchedItemInput } from '../src/lib/pricing/engine';
import { extractScope } from '../src/lib/agent/extractScope';
import { estimateMessageCostUsd, tierModel } from '../src/lib/agent/pricing-table';
import { llmProvider } from '../src/lib/llm/chat-provider';
import { openaiChatClient, type OpenAiChatResponse } from '../src/lib/llm/openai-chat';
import { embedQuery } from '../src/lib/retrieval/embedQuery';
import { matchCatalog } from '../src/lib/retrieval/matchCatalog';
import {
  falseFlagRate,
  hallucinatedLineRate,
  median,
  pricingErrorRate,
  scopePrecision,
  scopeRecall,
  skuAccuracyAt1,
  type LabelledItem,
  type OutputLine,
} from '../evals/metrics';

type Variant = 'A' | 'B' | 'C' | 'D';
const ALL_VARIANTS: Variant[] = ['A', 'B', 'C', 'D'];

// ---------------------------------------------------------------------------
// Golden set
// ---------------------------------------------------------------------------

interface GoldenCase {
  slug: string;
  transcript: string;
  labels: LabelledItem[];
}

const GOLDEN_DIR = path.resolve(process.cwd(), 'evals/golden');

function loadGoldenCases(): GoldenCase[] {
  const slugs = readdirSync(GOLDEN_DIR).filter((entry) =>
    existsSync(path.join(GOLDEN_DIR, entry, 'labels.json')),
  );
  return slugs.map((slug) => {
    const raw = JSON.parse(
      readFileSync(path.join(GOLDEN_DIR, slug, 'labels.json'), 'utf8'),
    ) as {
      expected_items: Array<{
        sku: string;
        quantity: number;
        unit: string;
        committed: boolean;
        correct_line_total: number;
      }>;
    };
    const transcriptPath = existsSync(path.join(GOLDEN_DIR, slug, 'transcript.md'))
      ? path.join(GOLDEN_DIR, slug, 'transcript.md')
      : path.join(GOLDEN_DIR, slug, 'transcript.txt');
    return {
      slug,
      transcript: readFileSync(transcriptPath, 'utf8'),
      labels: raw.expected_items.map((item) => ({
        sku: item.sku,
        quantity: item.quantity,
        unit: item.unit,
        committed: item.committed,
        correctLineTotal: item.correct_line_total,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Variant A: single-shot — one call, whole catalog in context, model does the
// arithmetic. The baseline the staged pipeline is measured against.
// ---------------------------------------------------------------------------

const singleShotSchema = z.object({
  lines: z.array(
    z.object({
      sku: z.string(),
      quantity: z.number(),
      unit_price: z.number(),
      line_total: z.number(),
    }),
  ),
});

const SINGLE_SHOT_SYSTEM =
  'You are a hardscape estimator for Greenscape Pro. Given a site-walk transcript and the ' +
  'price catalog, produce the priced proposal: pick catalog SKUs, decide quantities, and ' +
  'compute each line_total as quantity times unit_price. Only use catalog SKUs.';

function singleShotUserContent(
  transcript: string,
  catalog: Array<{ sku: string; name: string; category: string; unit: string; unit_price: number }>,
): string {
  const catalogText = catalog
    .map((row) => `${row.sku} | ${row.name} | ${row.category} | per ${row.unit} | $${row.unit_price}`)
    .join('\n');
  return (
    `<catalog>\n${catalogText}\n</catalog>\n\n<transcript>\n${transcript}\n</transcript>\n\n` +
    'Produce the priced proposal.'
  );
}

function parseSingleShot(input: unknown): OutputLine[] {
  const parsed = input !== undefined ? singleShotSchema.safeParse(input) : null;
  if (!parsed?.success) throw new Error('single-shot produced unparseable output');
  return parsed.data.lines.map((line) => ({
    sku: line.sku,
    quantity: line.quantity,
    lineTotal: line.line_total,
    needsReview: false,
  }));
}

async function runSingleShot(
  transcript: string,
  catalog: Array<{ sku: string; name: string; category: string; unit: string; unit_price: number }>,
): Promise<{ lines: OutputLine[]; costUsd: number }> {
  // Variant A is "one strong-tier call with the whole catalog in context" —
  // whichever provider LLM_PROVIDER selects. It must measure the same
  // provider family the staged variants run on.
  const model = tierModel('standard');

  if (llmProvider() === 'openai') {
    const response: OpenAiChatResponse = await openaiChatClient(model).messages.create({
      model,
      max_tokens: 4096,
      system: SINGLE_SHOT_SYSTEM,
      messages: [{ role: 'user', content: singleShotUserContent(transcript, catalog) }],
      tools: [
        {
          name: 'submit_priced_proposal',
          description: 'Submit the priced proposal lines.',
          input_schema: z.toJSONSchema(singleShotSchema),
        },
      ],
      tool_choice: { type: 'tool', name: 'submit_priced_proposal' },
    });
    const toolUse = response.content.find((block) => block.type === 'tool_use');
    const input: unknown = toolUse && 'input' in toolUse ? toolUse.input : undefined;
    return {
      lines: parseSingleShot(input),
      costUsd:
        estimateMessageCostUsd(model, response.usage.input_tokens, response.usage.output_tokens) ?? 0,
    };
  }

  const anthropic = new Anthropic();
  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: SINGLE_SHOT_SYSTEM,
    messages: [{ role: 'user', content: singleShotUserContent(transcript, catalog) }],
    tools: [
      {
        name: 'submit_priced_proposal',
        description: 'Submit the priced proposal lines.',
        input_schema: z.toJSONSchema(singleShotSchema) as unknown as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_priced_proposal' },
  });

  const costUsd = estimateMessageCostUsd(
    response.model ?? model,
    response.usage.input_tokens,
    response.usage.output_tokens,
  );

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  const input: unknown = toolUse && 'input' in toolUse ? toolUse.input : undefined;

  return { lines: parseSingleShot(input), costUsd: costUsd ?? 0 };
}

// ---------------------------------------------------------------------------
// Variants B/C/D: staged pipeline pieces.
// ---------------------------------------------------------------------------

interface MatchedAttempt {
  input: MatchedItemInput;
  committed: boolean;
}

type EvalSupabase = Awaited<ReturnType<typeof import('./lib/supabase').scriptSupabase>>;

async function runStaged(
  variant: 'B' | 'C',
  transcript: string,
  supabase: EvalSupabase,
): Promise<{ lines: OutputLine[]; costUsd: number }> {
  const extraction = await extractScope(transcript);
  let costUsd = extraction.totalCostUsd;

  const inputs: MatchedAttempt[] = [];
  for (const item of extraction.extraction.items) {
    const embedding = await embedQuery(item.normalized_query);
    costUsd += (estimateEmbeddingTokens(item.normalized_query) / 1_000_000) * 0.02;

    let matched: {
      id: string;
      sku: string;
      category: string;
      unit: string;
      unit_price: number;
      unit_cost: number;
      min_qty: number;
      matchMethod: string;
    } | null = null;

    if (variant === 'B') {
      const { data, error } = await supabase.rpc('search_catalog_vector', {
        p_query_embedding: embedding,
        p_match_count: 1,
      });
      if (error) throw new Error(`vector rpc failed: ${error.message}`);
      const top = (data ?? [])[0];
      if (top) {
        matched = {
          id: top.id,
          sku: top.sku,
          category: top.category,
          unit: top.unit,
          unit_price: top.unit_price,
          unit_cost: top.unit_cost,
          min_qty: top.min_qty,
          matchMethod: 'vector',
        };
      }
    } else {
      // Production matcher with production settings: matchCatalog runs the
      // fused RPC with the shipped RRF k / strategy depth and applies the
      // 0.55 MATCH_CONFIDENCE_THRESHOLD, labelling the winning strategy —
      // anything hand-rolled here would measure a different matcher than
      // the one that ships.
      const [candidate] = await matchCatalog(item.normalized_query, {
        queryEmbedding: embedding,
        topK: 1,
      });
      if (candidate && candidate.matchMethod !== 'unmatched') {
        matched = {
          id: candidate.catalogItem.id,
          sku: candidate.catalogItem.sku,
          category: candidate.catalogItem.category,
          unit: candidate.catalogItem.unit,
          unit_price: candidate.catalogItem.unit_price,
          unit_cost: candidate.catalogItem.unit_cost,
          min_qty: candidate.catalogItem.min_qty,
          matchMethod: candidate.matchMethod,
        };
      }
    }

    inputs.push({
      input: matched
        ? {
            catalogItemId: matched.id,
            sku: matched.sku,
            description: item.raw_phrase,
            category: matched.category,
            quantity: item.quantity,
            unit: matched.unit,
            unitPrice: matched.unit_price,
            unitCost: matched.unit_cost,
            minQty: matched.min_qty,
            matchMethod: matched.matchMethod,
            transcriptEvidence: item.evidence,
            evidenceVerified: item.evidence_verified,
          }
        : {
            description: item.raw_phrase,
            quantity: item.quantity,
            unit: item.unit,
            matchMethod: 'unmatched',
            transcriptEvidence: item.evidence,
            evidenceVerified: item.evidence_verified,
          },
      committed: item.committed,
    });
  }

  const priced = priceProposal(inputs.filter((entry) => entry.committed).map((entry) => entry.input));
  const lines: OutputLine[] = priced.lineItems.map((line) => ({
    sku: line.sku,
    quantity: line.quantity,
    lineTotal: line.lineTotal,
    needsReview: line.needsReview,
  }));
  // Uncommitted items were never priced — they surface as flagged $0 lines.
  for (const entry of inputs.filter((entry) => !entry.committed)) {
    lines.push({
      sku: entry.input.sku ?? null,
      quantity: entry.input.quantity ?? 0,
      lineTotal: 0,
      needsReview: true,
    });
  }

  return { lines, costUsd };
}

function estimateEmbeddingTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Variant D: guardrails over the staged result.
// ---------------------------------------------------------------------------

function applyGuardrails(
  lines: OutputLine[],
  costUsd: number,
  latencyMs: number,
  validCatalogIds: ReadonlySet<string>,
): { lines: OutputLine[]; results: ReturnType<typeof evaluateRules> } {
  const results = evaluateRules({
    proposalId: 'eval',
    extraction: {
      schemaValid: true,
      retryCount: 0,
      items: lines.map((line) => ({
        rawPhrase: line.sku ?? 'unmatched',
        committed: true,
        evidenceVerified: true,
      })),
    },
    proposal: {
      total: lines.reduce((sum, line) => sum + (line.needsReview ? 0 : line.lineTotal), 0),
      marginPct: 45,
      lineItems: lines.map((line) => ({
        sku: line.sku,
        catalogItemId: line.sku,
        description: line.sku ?? 'unmatched',
        quantity: line.quantity,
        lineTotal: line.needsReview ? 0 : line.lineTotal,
        committed: true,
      })),
    },
    validCatalogIds,
    agentRunCostUsd: costUsd,
    elapsedMs: latencyMs,
  });

  const blockedIndexes = new Set(
    results.flatMap((result) =>
      !result.passed && result.severity === 'block' && result.lineIndex !== undefined
        ? [result.lineIndex]
        : [],
    ),
  );
  return {
    lines: lines.map((line, index) => ({
      ...line,
      needsReview: line.needsReview || blockedIndexes.has(index),
    })),
    results,
  };
}

// ---------------------------------------------------------------------------
// Aggregation and reporting
// ---------------------------------------------------------------------------

interface VariantStats {
  variant: Variant;
  label: string;
  recall: number[];
  precision: number[];
  acc1: number[];
  pricingErrors: number[];
  hallucination: number[];
  falseFlags: number[];
  latencies: number[];
  costs: number[];
}

function pct(value: number | null): string {
  return value == null ? '—' : `${(value * 100).toFixed(1)}%`;
}

function parseOnlyFlag(): Variant[] {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return ALL_VARIANTS;
  const requested = arg
    .slice('--only='.length)
    .split(',')
    .map((v) => v.trim().toUpperCase());
  const valid = requested.filter((v): v is Variant => ALL_VARIANTS.includes(v as Variant));
  if (valid.length === 0) {
    console.error('no valid variants in --only (use A,B,C,D)');
    process.exit(1);
  }
  return valid;
}

async function main(): Promise<void> {
  const cases = loadGoldenCases();
  if (process.argv.includes('--list')) {
    for (const entry of cases) {
      const committed = entry.labels.filter((l) => l.committed);
      const total = committed.reduce((sum, l) => sum + l.correctLineTotal, 0);
      console.log(`${entry.slug}: ${entry.labels.length} labelled items (${committed.length} committed), expected $${total.toFixed(2)}`);
    }
    return;
  }

  const variants = parseOnlyFlag();

  // Loaded lazily: --list must work without the server-only import chain.
  const { scriptSupabase } = await import('./lib/supabase');
  const supabase = scriptSupabase();

  // Catalog for the single-shot prompt (and to know how many rows exist).
  const { data: catalog, error: catalogError } = await supabase
    .from('catalog_items')
    .select('sku, name, category, unit, unit_price');
  if (catalogError) throw new Error(`catalog load failed: ${catalogError.message}`);
  if (!catalog || catalog.length === 0) throw new Error('catalog is empty — run db:seed first');

  const stats: Record<Variant, VariantStats> = {
    A: { variant: 'A', label: 'A single-shot', recall: [], precision: [], acc1: [], pricingErrors: [], hallucination: [], falseFlags: [], latencies: [], costs: [] },
    B: { variant: 'B', label: 'B extract + vector + engine', recall: [], precision: [], acc1: [], pricingErrors: [], hallucination: [], falseFlags: [], latencies: [], costs: [] },
    C: { variant: 'C', label: 'C extract + hybrid RRF + engine', recall: [], precision: [], acc1: [], pricingErrors: [], hallucination: [], falseFlags: [], latencies: [], costs: [] },
    D: { variant: 'D', label: 'D = C + guardrails', recall: [], precision: [], acc1: [], pricingErrors: [], hallucination: [], falseFlags: [], latencies: [], costs: [] },
  };

  for (const variant of variants) {
    for (const entry of cases) {
      const startedAt = Date.now();
      let lines: OutputLine[];
      let costUsd: number;

      if (variant === 'A') {
        const single = await runSingleShot(entry.transcript, catalog);
        lines = single.lines;
        costUsd = single.costUsd;
      } else {
        const staged = await runStaged(variant === 'B' ? 'B' : 'C', entry.transcript, supabase);
        if (variant === 'D') {
          const guarded = applyGuardrails(staged.lines, staged.costUsd, Date.now() - startedAt, new Set(catalog.map((row) => row.sku)));
          lines = guarded.lines;
        } else {
          lines = staged.lines;
        }
        costUsd = staged.costUsd;
      }

      const statsForVariant = stats[variant];
      statsForVariant.recall.push(scopeRecall(entry.labels, lines));
      statsForVariant.precision.push(scopePrecision(entry.labels, lines) ?? 0);
      statsForVariant.acc1.push(skuAccuracyAt1(entry.labels, lines) ?? 0);
      statsForVariant.pricingErrors.push(pricingErrorRate(entry.labels, lines) ?? 0);
      statsForVariant.hallucination.push(hallucinatedLineRate(entry.labels, lines) ?? 0);
      statsForVariant.falseFlags.push(falseFlagRate(entry.labels, lines) ?? 0);
      statsForVariant.latencies.push(Date.now() - startedAt);
      statsForVariant.costs.push(costUsd);
      console.log(`  ${variant} ${entry.slug}: ${lines.length} lines, $${costUsd.toFixed(4)}`);
    }
  }

  const rows = variants.map((variant) => {
    const s = stats[variant];
    return {
      variant,
      label: s.label,
      recall: median(s.recall),
      precision: median(s.precision),
      acc1: median(s.acc1),
      pricingError: median(s.pricingErrors),
      hallucination: median(s.hallucination),
      falseFlag: median(s.falseFlags),
      medianLatencyMs: median(s.latencies),
      costPerProposal: median(s.costs),
    };
  });

  const header = '| variant | scope recall | scope precision | sku acc@1 | pricing error | hallucinated line | false-flag (headline) | median latency | cost/proposal |';
  const divider = '|---|---:|---:|---:|---:|---:|---:|---:|---:|';
  const tableRows = rows.map((row) =>
    `| ${row.label} | ${pct(row.recall)} | ${pct(row.precision)} | ${pct(row.acc1)} | ${pct(row.pricingError)} | ${pct(row.hallucination)} | ${pct(row.falseFlag)} | ${row.medianLatencyMs ?? '—'} ms | $${(row.costPerProposal ?? 0).toFixed(4)} |`,
  );
  const markdown = [`# Pipeline ablation — golden set (${cases.length} cases)`, '', header, divider, ...tableRows, ''].join('\n');

  console.log(`\n${markdown}`);
  writeFileSync(path.resolve(process.cwd(), 'evals/RESULTS.md'), markdown + '\n');
  console.log('wrote evals/RESULTS.md');
}

void main();
