'use client';

import {
  MARGIN_FLOOR_PCT,
  ORCHESTRATION_LIMIT_MS,
  PROPOSAL_COST_CEILING_USD,
  TOTAL_MAX_USD,
  TOTAL_MIN_USD,
  type GuardrailResult,
} from '@/lib/guardrails/rules';

export interface RightRailProps {
  totals: {
    subtotal: number;
    mobilizationFee: number;
    contingency: number;
    tax: number;
    total: number;
    marginPct: number;
  };
  guardrailResults: GuardrailResult[];
  optionalLines: Array<{ description: string; quantity: number; unit: string }>;
  generationCostUsd: number;
  elapsedMs: number | null;
}

const usd = (value: number): string =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

function MarginGauge({ marginPct }: { marginPct: number }) {
  const width = Math.max(0, Math.min(100, marginPct));
  const belowFloor = marginPct < MARGIN_FLOOR_PCT;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Gross margin</span>
        <span className={`font-medium tabular-nums ${belowFloor ? 'text-red-600' : 'text-emerald-700'}`}>
          {marginPct.toFixed(1)}%
        </span>
      </div>
      <div className="relative mt-1 h-2.5 rounded-full bg-muted">
        <div
          className={`h-full rounded-full ${belowFloor ? 'bg-red-500' : 'bg-emerald-500'}`}
          style={{ width: `${width}%` }}
        />
        {/* The 30% floor Marcus must stay above. */}
        <div
          className="absolute top-[-3px] h-[17px] w-0.5 bg-foreground/70"
          style={{ left: `${MARGIN_FLOOR_PCT}%` }}
          title={`${MARGIN_FLOOR_PCT}% floor`}
        />
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        ▲ {MARGIN_FLOOR_PCT}% floor — below it G4 blocks approval
      </p>
    </div>
  );
}

// One-liners for admins hovering a rule in the guardrails panel. Kept as UI
// copy here so the wording stays reviewable without touching rules.ts.
const RULE_EXPLANATIONS: Record<string, string> = {
  G1_schema_valid:
    'The extracted quote data passed schema validation (auto-retried up to 2 times on failure).',
  G2_evidence_grounded:
    'Every priced line item is backed by something said in the site-walk transcript.',
  G3_catalog_grounded:
    'All line items reference real catalog products and prices — nothing was invented.',
  G4_margin_floor: `Gross margin is at or above the ${MARGIN_FLOOR_PCT}% floor. Below it the proposal cannot be approved.`,
  G5_total_bounds: `Total sits inside the client's stated project range (${usd(TOTAL_MIN_USD)}–${usd(TOTAL_MAX_USD)}). Out of range is expected sometimes — advisory only, but worth a quick look at scope.`,
  G6_quantity_sanity:
    'Quantities are compared against historical percentiles to catch typos (e.g. a 40x quantity error).',
  G7_uncommitted_items:
    'Scope the customer asked about but never committed to stays optional and unpriced, never silently added.',
  G8_cost_ceiling: `The agent run's API cost stayed under the ${usd(PROPOSAL_COST_CEILING_USD)} per-proposal ceiling.`,
  G9_wall_clock: `The whole pipeline finished within the ${ORCHESTRATION_LIMIT_MS / 1000}s time limit.`,
};

function RuleRow({ result }: { result: GuardrailResult }) {
  return (
    <li
      className="flex items-start justify-between gap-2 py-0.5"
      title={RULE_EXPLANATIONS[result.rule] ?? 'Guardrail check'}
    >
      <span className="cursor-help text-xs underline decoration-dotted underline-offset-2">
        {result.rule}
      </span>
      <span className={`text-xs font-medium ${result.passed ? 'text-emerald-700' : result.severity === 'block' ? 'text-red-600' : 'text-amber-600'}`}>
        {result.passed ? 'ok' : result.severity}
      </span>
    </li>
  );
}

export function RightRail({
  totals,
  guardrailResults,
  optionalLines,
  generationCostUsd,
  elapsedMs,
}: RightRailProps) {
  const failed = guardrailResults.filter((r) => !r.passed);
  const blocks = failed.filter((r) => r.severity === 'block');
  const warns = failed.filter((r) => r.severity === 'warn');

  return (
    <aside className="flex flex-col gap-4 rounded-xl border bg-card p-4">
      <dl className="flex flex-col gap-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{usd(totals.subtotal)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Mobilization</dt>
          <dd className="tabular-nums">{usd(totals.mobilizationFee)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Contingency (5%)</dt>
          <dd className="tabular-nums">{usd(totals.contingency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Tax (materials)</dt>
          <dd className="tabular-nums">{usd(totals.tax)}</dd>
        </div>
        <div className="mt-1 flex justify-between border-t pt-1.5 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular-nums">{usd(totals.total)}</dd>
        </div>
      </dl>

      <MarginGauge marginPct={totals.marginPct} />

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Guardrails</h3>
        {blocks.length > 0 && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2">
            <p
              className="text-xs font-semibold text-red-700"
              title="At least one hard guardrail failed. Approval stays disabled until the proposal is fixed and re-reviewed."
            >
              Blocking — approval disabled
            </p>
            <ul className="mt-1 divide-y divide-red-100">
              {blocks.map((result) => (
                <RuleRow key={result.rule} result={result} />
              ))}
            </ul>
          </div>
        )}
        {warns.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
            <p
              className="text-xs font-semibold text-amber-700"
              title="Soft flags that never block approval. Hover a rule below to see what it checks."
            >
              Warnings — advisory only
            </p>
            <ul className="mt-1 divide-y divide-amber-100">
              {warns.map((result) => (
                <RuleRow key={result.rule} result={result} />
              ))}
            </ul>
          </div>
        )}
        {blocks.length === 0 && warns.length === 0 && (
          <p className="text-xs text-emerald-700">All nine guardrails passing.</p>
        )}
      </section>

      {optionalLines.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Optional add-ons — not priced
          </h3>
          <ul className="flex flex-col gap-1">
            {optionalLines.map((line) => (
              <li key={line.description} className="text-xs text-muted-foreground">
                {line.description} ({line.quantity} {line.unit})
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t pt-2 text-xs text-muted-foreground">
        <p>
          Agent spend:{' '}
          <span className="font-medium tabular-nums text-foreground">
            ${generationCostUsd.toFixed(2)}
          </span>
        </p>
        <p>
          Pipeline wall clock:{' '}
          <span className="font-medium tabular-nums text-foreground">
            {elapsedMs == null ? '—' : `${(elapsedMs / 1000).toFixed(1)}s`}
          </span>
        </p>
      </section>
    </aside>
  );
}
