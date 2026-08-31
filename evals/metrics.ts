/**
 * Metric definitions for the pipeline ablation. All pure functions over
 * labelled golden items and the variant's output lines.
 *
 * Definitions (documented so the numbers mean the same thing next quarter):
 * - scope item recall:        labelled COMMITTED items whose SKU appears on some
 *                             output line / labelled committed items.
 * - scope item precision:     output lines whose SKU matches a labelled
 *                             committed item / total output lines (null when no lines).
 * - SKU match accuracy@1:     labelled committed items whose expected SKU appears
 *                             with the expected quantity on some output line /
 *                             labelled committed items. A wrong-SKU match counts
 *                             as a miss — there is no gold correspondence for a
 *                             wrong answer.
 * - pricing error rate:       output lines whose SKU matches a label but whose
 *                             line total differs from the labelled correct total
 *                             by more than one cent / matched lines (null when none).
 * - hallucinated line rate:   PRICED (non-flagged) output lines whose SKU is not
 *                             in the labelled set / priced lines. Unmatched $0
 *                             lines are flagged, not hallucinated.
 * - false-flag rate (headline): flagged lines that were actually correct — SKU
 *                             and quantity match a labelled committed item and the
 *                             line total is within a cent of correct — / total
 *                             flagged lines. This is the cost of over-caution:
 *                             every false flag is a moment of Marcus's attention
 *                             the tool wasted.
 */

export interface LabelledItem {
  sku: string;
  quantity: number;
  unit: string;
  committed: boolean;
  correctLineTotal: number;
}

export interface OutputLine {
  sku: string | null;
  quantity: number;
  lineTotal: number;
  needsReview: boolean;
}

export function isLabelledSku(labels: LabelledItem[], sku: string | null): boolean {
  return sku !== null && labels.some((label) => label.sku === sku);
}

export function scopeRecall(labels: LabelledItem[], lines: OutputLine[]): number {
  const committed = labels.filter((label) => label.committed);
  if (committed.length === 0) return 1;
  const hit = committed.filter((label) => lines.some((line) => line.sku === label.sku));
  return hit.length / committed.length;
}

export function scopePrecision(labels: LabelledItem[], lines: OutputLine[]): number | null {
  if (lines.length === 0) return null;
  const labelled = lines.filter((line) => isLabelledSku(labels, line.sku));
  return labelled.length / lines.length;
}

export function skuAccuracyAt1(labels: LabelledItem[], lines: OutputLine[]): number | null {
  const committed = labels.filter((label) => label.committed);
  if (committed.length === 0) return null;
  const hit = committed.filter((label) =>
    lines.some((line) => line.sku === label.sku && line.quantity === label.quantity),
  );
  return hit.length / committed.length;
}

export function pricingErrorRate(labels: LabelledItem[], lines: OutputLine[]): number | null {
  const matched = lines.filter(
    (line) => line.sku !== null && labels.some((label) => label.sku === line.sku),
  );
  if (matched.length === 0) return null;
  const errors = matched.filter((line) => {
    const label = labels.find((label) => label.sku === line.sku);
    return label === undefined || Math.abs(line.lineTotal - label.correctLineTotal) > 0.01;
  });
  return errors.length / matched.length;
}

export function hallucinatedLineRate(labels: LabelledItem[], lines: OutputLine[]): number | null {
  const priced = lines.filter((line) => !line.needsReview);
  if (priced.length === 0) return null;
  const hallucinated = priced.filter((line) => !isLabelledSku(labels, line.sku));
  return hallucinated.length / priced.length;
}

export function falseFlagRate(labels: LabelledItem[], lines: OutputLine[]): number | null {
  const flagged = lines.filter((line) => line.needsReview);
  if (flagged.length === 0) return null;
  const falseFlags = flagged.filter((line) =>
    labels.some(
      (label) =>
        label.committed &&
        line.sku === label.sku &&
        line.quantity === label.quantity &&
        Math.abs(line.lineTotal - label.correctLineTotal) <= 0.01,
    ),
  );
  return falseFlags.length / flagged.length;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}
