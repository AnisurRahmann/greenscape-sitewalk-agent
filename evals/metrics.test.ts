import { describe, expect, it } from 'vitest';

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
} from './metrics';

const labels: LabelledItem[] = [
  { sku: 'TRV-IVY-1624', quantity: 800, unit: 'sqft', committed: true, correctLineTotal: 20_800 },
  { sku: 'FF-PIT-RD-ML', quantity: 1, unit: 'ea', committed: true, correctLineTotal: 6_900 },
  { sku: 'FF-PLC-CST', quantity: 1, unit: 'ea', committed: false, correctLineTotal: 0 },
];

const line = (overrides: Partial<OutputLine>): OutputLine => ({
  sku: 'TRV-IVY-1624',
  quantity: 800,
  lineTotal: 20_800,
  needsReview: false,
  ...overrides,
});

describe('scopeRecall / scopePrecision', () => {
  it('counts only committed labelled items for recall', () => {
    expect(scopeRecall(labels, [line({})])).toBe(0.5);
    expect(
      scopeRecall(labels, [line({}), line({ sku: 'FF-PIT-RD-ML', quantity: 1, lineTotal: 6900 })]),
    ).toBe(1);
  });

  it('precision counts lines whose sku is labelled, committed or not', () => {
    expect(scopePrecision(labels, [line({}), line({ sku: 'FF-PLC-CST', lineTotal: 0, needsReview: true })])).toBe(1);
    expect(scopePrecision(labels, [line({ sku: 'MADE-UP' })])).toBe(0);
    expect(scopePrecision(labels, [])).toBeNull();
  });
});

describe('skuAccuracyAt1', () => {
  it('requires both sku and quantity to be exactly right', () => {
    expect(skuAccuracyAt1(labels, [line({})])).toBe(0.5);
    expect(skuAccuracyAt1(labels, [line({ quantity: 799 }), line({ sku: 'FF-PIT-RD-ML', quantity: 1, lineTotal: 6900 })])).toBe(0.5);
  });
});

describe('pricingErrorRate', () => {
  it('is null with no matched lines', () => {
    expect(pricingErrorRate(labels, [line({ sku: null, lineTotal: 0 })])).toBeNull();
  });

  it('flags wrong prices, tolerating one cent', () => {
    const oneCentOff = pricingErrorRate(labels, [line({ lineTotal: 20_800.01 })]);
    expect(oneCentOff).toBe(0);
    const wrong = pricingErrorRate(labels, [line({ lineTotal: 21_000 })]);
    expect(wrong).toBe(1);
  });
});

describe('hallucinatedLineRate', () => {
  it('counts priced lines with no labelled sku, ignoring flagged ones', () => {
    const rate = hallucinatedLineRate(labels, [
      line({}),
      line({ sku: 'MADE-UP-1', lineTotal: 9_999 }),
      line({ sku: null, lineTotal: 0, needsReview: true }),
    ]);
    expect(rate).toBeCloseTo(1 / 2, 6);
  });
});

describe('falseFlagRate — the headline metric', () => {
  it('is null when nothing is flagged', () => {
    expect(falseFlagRate(labels, [line({})])).toBeNull();
  });

  it('counts a flag as false when the flagged line was actually correct', () => {
    const rate = falseFlagRate(labels, [
      line({ needsReview: true }), // correct line, wrongly sent to review
      line({ sku: 'FF-PIT-RD-ML', quantity: 1, lineTotal: 6_900, needsReview: true }), // correct too
    ]);
    expect(rate).toBe(1);
  });

  it('counts justified flags as true flags', () => {
    const rate = falseFlagRate(labels, [
      line({ sku: null, quantity: 0, lineTotal: 0, needsReview: true }), // unmatched: justified
    ]);
    expect(rate).toBe(0);
  });
});

describe('median', () => {
  it('handles even and odd lengths and the empty case', () => {
    expect(median([])).toBeNull();
    expect(median([3])).toBe(3);
    expect(median([1, 9])).toBe(5);
    expect(median([5, 1, 9])).toBe(5);
  });
});
