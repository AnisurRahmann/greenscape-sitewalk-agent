import { describe, expect, it } from 'vitest';

import { priceProposal, splitCustomerLines, type MatchedItemInput } from './engine';
import { toCents } from './money';

function baseItem(overrides: Partial<MatchedItemInput> = {}): MatchedItemInput {
  return {
    catalogItemId: 'cat-1',
    sku: 'TEST-1',
    description: 'test item',
    category: 'Fire Features',
    quantity: 10,
    unit: 'ea',
    unitPrice: 100,
    unitCost: 55,
    minQty: 0,
    materialsRatio: 0.45,
    matchMethod: 'hybrid',
    matchConfidence: 0.9,
    transcriptEvidence: 'test item',
    evidenceVerified: true,
    ...overrides,
  };
}

function paverItem(overrides: Partial<MatchedItemInput> = {}): MatchedItemInput {
  return baseItem({
    catalogItemId: 'cat-trv',
    sku: 'TRV-IVY-1624',
    description: 'ivory travertine paver',
    category: 'Pavers & Travertine',
    unit: 'sqft',
    unitPrice: 26,
    unitCost: 15,
    ...overrides,
  });
}

describe('priceProposal — volume tiers', () => {
  it('charges full unit price at exactly 800 sqft', () => {
    const proposal = priceProposal([paverItem({ quantity: 800 })]);
    expect(proposal.lineItems[0]?.unitPrice).toBe(26);
    expect(proposal.lineItems[0]?.effectiveUnitPrice).toBe(26);
    expect(proposal.lineItems[0]?.discountBps).toBe(0);
    expect(proposal.lineItems[0]?.lineTotal).toBe(20_800);
    expect(proposal.subtotal).toBe(20_800);
  });

  it('applies the 4% tier strictly over 800 sqft', () => {
    const proposal = priceProposal([paverItem({ quantity: 801 })]);
    // unitPrice stays the catalog list price; the tier is recorded separately.
    expect(proposal.lineItems[0]?.unitPrice).toBe(26);
    expect(proposal.lineItems[0]?.effectiveUnitPrice).toBe(24.96);
    expect(proposal.lineItems[0]?.discountBps).toBe(400);
    expect(proposal.lineItems[0]?.lineTotal).toBe(19_992.96);
  });

  it('keeps the 4% tier at exactly 1500 sqft', () => {
    const proposal = priceProposal([paverItem({ quantity: 1500 })]);
    expect(proposal.lineItems[0]?.unitPrice).toBe(26);
    expect(proposal.lineItems[0]?.effectiveUnitPrice).toBe(24.96);
    expect(proposal.lineItems[0]?.discountBps).toBe(400);
    expect(proposal.lineItems[0]?.lineTotal).toBe(37_440);
  });

  it('applies the 7% tier strictly over 1500 sqft', () => {
    const proposal = priceProposal([paverItem({ quantity: 1501 })]);
    expect(proposal.lineItems[0]?.unitPrice).toBe(26);
    expect(proposal.lineItems[0]?.effectiveUnitPrice).toBe(24.18);
    expect(proposal.lineItems[0]?.discountBps).toBe(700);
    expect(proposal.lineItems[0]?.lineTotal).toBe(36_294.18);
  });

  it('never discounts non-sqft or non-tier categories', () => {
    const ea = priceProposal([paverItem({ unit: 'ea', quantity: 2000 })]);
    expect(ea.lineItems[0]?.unitPrice).toBe(26);
    expect(ea.lineItems[0]?.discountBps).toBe(0);

    const concrete = priceProposal([
      baseItem({ category: 'Concrete & Stamped', unit: 'sqft', quantity: 2000, unitPrice: 11.5 }),
    ]);
    expect(concrete.lineItems[0]?.unitPrice).toBe(11.5);
    expect(concrete.lineItems[0]?.discountBps).toBe(0);
  });
});

describe('priceProposal — idempotency (rule 1: the engine computes each number once)', () => {
  it('re-pricing its own output reproduces the same proposal — the double-discount repro', () => {
    // Demo-seed repro: TF-PET-70 at 900 sqft used to persist the discounted
    // 9.36 and re-price to 8091. Now the list price is preserved...
    const once = priceProposal([
      paverItem({ sku: 'TF-PET-70', unitPrice: 9.75, unitCost: 5.66, quantity: 900 }),
    ]);
    expect(once.lineItems[0]?.unitPrice).toBe(9.75);
    expect(once.lineItems[0]?.effectiveUnitPrice).toBe(9.36);
    expect(once.lineItems[0]?.discountBps).toBe(400);
    expect(once.lineItems[0]?.lineTotal).toBe(8_424);

    // ...so feeding the priced lines back through the engine is a no-op.
    const twice = priceProposal(once.lineItems);
    expect(twice).toEqual(once);
  });

  it('is idempotent across a mixed proposal of tiered and non-tiered lines', () => {
    const proposal = priceProposal([
      paverItem({ quantity: 2000, unitPrice: 26, unitCost: 15 }), // 7% tier
      paverItem({ quantity: 900, unitPrice: 9.75, unitCost: 5.66 }), // 4% tier
      baseItem({ category: 'Drainage', unit: 'lf', quantity: 50, unitPrice: 46, unitCost: 27.6 }),
    ]);

    const repriced = priceProposal(proposal.lineItems);
    expect(repriced).toEqual(proposal);
    expect(repriced.total).toBe(proposal.total);
  });
});

describe('priceProposal — min_qty coercion', () => {
  it('coerces quantity up to the catalog minimum', () => {
    const proposal = priceProposal([
      baseItem({ quantity: 100, minQty: 250, unitPrice: 18 }),
    ]);
    expect(proposal.lineItems[0]?.quantity).toBe(250);
    expect(proposal.lineItems[0]?.lineTotal).toBe(4_500);
  });

  it('uses the minimum when no quantity was extracted', () => {
    const proposal = priceProposal([
      baseItem({ quantity: null, minQty: 250, unitPrice: 18 }),
    ]);
    expect(proposal.lineItems[0]?.quantity).toBe(250);
    expect(proposal.lineItems[0]?.lineTotal).toBe(4_500);
  });

  it('never coerces downward', () => {
    const proposal = priceProposal([
      baseItem({ quantity: 500, minQty: 250, unitPrice: 18 }),
    ]);
    expect(proposal.lineItems[0]?.quantity).toBe(500);
  });
});

describe('priceProposal — mobilization', () => {
  it('still charges the flat fee at exactly $40,000 subtotal', () => {
    const proposal = priceProposal([baseItem({ unitPrice: 400, quantity: 100 })]);
    expect(proposal.subtotal).toBe(40_000);
    expect(proposal.mobilizationFee).toBe(850);
    // 5% contingency + 8.6% tax on 45% materials, all visible
    expect(proposal.contingency).toBe(2_000);
    expect(proposal.tax).toBe(1_548);
    expect(proposal.total).toBe(40_000 + 850 + 2_000 + 1_548);
  });

  it('waives the fee strictly above $40,000 subtotal', () => {
    const proposal = priceProposal([baseItem({ unitPrice: 400.01, quantity: 100 })]);
    expect(proposal.subtotal).toBe(40_001);
    expect(proposal.mobilizationFee).toBe(0);
    expect(proposal.contingency).toBe(2_000.05);
    // Engine total is exact because it is computed in integer cents; adding
    // these dollars in float here would produce 43549.090000000004.
    expect(proposal.total).toBe(43_549.09);
  });

  it('charges no fee when nothing is billable', () => {
    const proposal = priceProposal([]);
    expect(proposal.mobilizationFee).toBe(0);

    const allUnmatched = priceProposal([
      baseItem({ matchMethod: 'unmatched', description: 'mystery item' }),
    ]);
    expect(allUnmatched.mobilizationFee).toBe(0);
  });
});

describe('priceProposal — Phoenix tax on materials only', () => {
  it('taxes 8.6% of the 45% default materials share', () => {
    const proposal = priceProposal([baseItem({ unitPrice: 100, quantity: 100 })]);
    expect(proposal.lineItems[0]?.lineTotal).toBe(10_000);
    expect(proposal.materialsSubtotal).toBe(4_500);
    expect(proposal.tax).toBe(387);
  });

  it('honours the catalog materials_ratio over the 45% default', () => {
    const full = priceProposal([baseItem({ unitPrice: 100, quantity: 100, materialsRatio: 1 })]);
    expect(full.materialsSubtotal).toBe(10_000);
    expect(full.tax).toBe(860);

    const none = priceProposal([baseItem({ unitPrice: 100, quantity: 100, materialsRatio: 0 })]);
    expect(none.tax).toBe(0);
  });

  it('supports a custom tax rate via context', () => {
    const proposal = priceProposal([baseItem({ unitPrice: 100, quantity: 100 })], {
      taxRateBps: 0,
    });
    expect(proposal.tax).toBe(0);
  });
});

describe('priceProposal — cost and margin', () => {
  it('computes cost_total from unit_cost and margin from the total', () => {
    const proposal = priceProposal([baseItem({ unitPrice: 100, quantity: 100, unitCost: 55 })]);
    expect(proposal.costTotal).toBe(5_500);
    // total = 10000 + 850 + 500 + 387 = 11737; margin = (11737-5500)/11737
    expect(proposal.marginPct).toBeCloseTo(((11_737 - 5_500) / 11_737) * 100, 2);
  });
});

describe('priceProposal — unmatched and empty proposals', () => {
  it('prices a zero-item proposal at zero with no fees', () => {
    const proposal = priceProposal([]);
    expect(proposal.lineItems).toEqual([]);
    expect(proposal.subtotal).toBe(0);
    expect(proposal.mobilizationFee).toBe(0);
    expect(proposal.contingency).toBe(0);
    expect(proposal.tax).toBe(0);
    expect(proposal.total).toBe(0);
    expect(proposal.costTotal).toBe(0);
    expect(proposal.marginPct).toBe(0);
  });

  it('carries every unmatched item visibly at $0 with needs_review', () => {
    const proposal = priceProposal([
      baseItem({ matchMethod: 'unmatched', description: 'that fancy stone patio thing' }),
      baseItem({
        matchMethod: 'unmatched',
        sku: null,
        catalogItemId: null,
        description: 'mystery drainage gizmo',
      }),
    ]);

    expect(proposal.lineItems).toHaveLength(2);
    for (const line of proposal.lineItems) {
      expect(line.unitPrice).toBe(0);
      expect(line.lineTotal).toBe(0);
      expect(line.needsReview).toBe(true);
    }
    expect(proposal.lineItems[0]?.description).toContain('that fancy stone patio thing');
    expect(proposal.lineItems[0]?.description).toMatch(/\[Needs review/);
    expect(proposal.subtotal).toBe(0);
    expect(proposal.total).toBe(0);
  });

  it('keeps unmatched lines next to priced ones in a mixed proposal', () => {
    const proposal = priceProposal([
      baseItem({ unitPrice: 100, quantity: 10 }),
      baseItem({ matchMethod: 'unmatched', description: 'unknown gizmo' }),
      baseItem({ quantity: null, minQty: 0, description: 'priced but no quantity' }),
    ]);

    expect(proposal.lineItems).toHaveLength(3);
    expect(proposal.subtotal).toBe(1_000);
    expect(proposal.lineItems[0]?.needsReview).toBe(false);
    expect(proposal.lineItems[1]?.needsReview).toBe(true);
    expect(proposal.lineItems[1]?.lineTotal).toBe(0);
    // Priced line with no quantity at all still needs a human.
    expect(proposal.lineItems[2]?.needsReview).toBe(true);
    expect(proposal.lineItems[2]?.quantity).toBe(0);
  });
});

describe('priceProposal — invariants (property test)', () => {
  // Deterministic PRNG so failures reproduce exactly.
  function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
  }

  const CATEGORIES = [
    'Pavers & Travertine',
    'Artificial Turf',
    'Fire Features',
    'Concrete & Stamped',
    'Design Fees',
  ];
  const UNITS = ['sqft', 'ea', 'lf'];
  const MIN_QTYS = [0, 100, 250];

  it('subtotal always equals the sum of line totals, and total is exact', () => {
    const rand = mulberry32(20260831);
    const pick = <T,>(values: T[]): T => values[Math.floor(rand() * values.length)]!;

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const itemCount = 1 + Math.floor(rand() * 8);
      const items: MatchedItemInput[] = [];
      for (let i = 0; i < itemCount; i += 1) {
        const unmatched = rand() < 0.1;
        items.push(
          unmatched
            ? baseItem({ matchMethod: 'unmatched', description: `unmatched ${i}`, quantity: null })
            : baseItem({
                category: pick(CATEGORIES),
                unit: pick(UNITS),
                unitPrice: Math.round(rand() * 6000) / 100 + 1,
                unitCost: Math.round(rand() * 3000) / 100,
                quantity: Math.floor(rand() * 2000),
                minQty: pick(MIN_QTYS),
                materialsRatio: Math.round(rand() * 10) / 10,
                description: `item ${iteration}-${i}`,
              }),
        );
      }

      const proposal = priceProposal(items);

      const lineCents = proposal.lineItems.map((line) => toCents(line.lineTotal));
      expect(toCents(proposal.subtotal)).toBe(lineCents.reduce((a, b) => a + b, 0));

      const expectedTotal =
        toCents(proposal.subtotal) +
        toCents(proposal.mobilizationFee) +
        toCents(proposal.contingency) +
        toCents(proposal.tax);
      expect(toCents(proposal.total)).toBe(expectedTotal);

      // Every currency output is exact integer cents — no float drift.
      for (const value of [
        proposal.subtotal,
        proposal.mobilizationFee,
        proposal.contingency,
        proposal.tax,
        proposal.total,
        proposal.costTotal,
        proposal.materialsSubtotal,
        ...proposal.lineItems.flatMap((line) => [line.unitPrice, line.unitCost, line.lineTotal]),
      ]) {
        expect(Math.abs(value * 100 - Math.round(value * 100))).toBeLessThan(1e-6);
      }
      expect(Number.isFinite(proposal.marginPct)).toBe(true);
    }
  });
});

describe('splitCustomerLines', () => {
  type Row = {
    description: string;
    needs_review: boolean;
    line_total: number;
    match_method: string | null;
    excluded: boolean;
  };

  function row(overrides: Partial<Row> = {}): Row {
    return {
      description: 'paver section',
      needs_review: false,
      line_total: 8_400,
      match_method: 'hybrid',
      excluded: false,
      ...overrides,
    };
  }

  it('splits stored rows into priced lines and $0 optional add-ons', () => {
    const { priced, optionalAddOns } = splitCustomerLines([
      row(),
      row({ description: 'ramada someday', needs_review: true, line_total: 0 }),
    ]);
    expect(priced.map((line) => line.description)).toEqual(['paver section']);
    expect(optionalAddOns.map((line) => line.description)).toEqual(['ramada someday']);
  });

  it('drops unmatched lines from both buckets — they are reviewer-only', () => {
    const { priced, optionalAddOns } = splitCustomerLines([
      row({ match_method: 'unmatched', needs_review: true, line_total: 0 }),
      row({ match_method: 'unmatched', line_total: 1_200 }),
      row(),
    ]);
    expect(priced.map((line) => line.description)).toEqual(['paver section']);
    expect(optionalAddOns).toHaveLength(0);
  });

  it('drops excluded (soft-deleted) rows from both buckets', () => {
    const { priced, optionalAddOns } = splitCustomerLines([
      row({ excluded: true }),
      row({ description: 'ramada someday', needs_review: true, line_total: 0, excluded: true }),
      row(),
    ]);
    expect(priced).toHaveLength(1);
    expect(optionalAddOns).toHaveLength(0);
  });

  it('keeps manual lines the reviewer priced, with or without a catalog match', () => {
    const { priced } = splitCustomerLines([
      row({ match_method: 'manual' }),
      row({ description: 'custom steel edging', match_method: 'manual' }),
    ]);
    expect(priced).toHaveLength(2);
  });
});

describe('catalog snapshot on priced lines', () => {
  it('keeps the rendered description and sku stable after the catalog row is renamed', () => {
    // The catalog row as it existed at match time.
    const catalogRow = { id: 'cat-1', sku: 'TF-PET-70', name: 'Pet-Friendly Artificial Turf' };
    const priced = priceProposal([
      baseItem({
        catalogItemId: catalogRow.id,
        sku: catalogRow.sku,
        catalogName: catalogRow.name,
        description: catalogRow.name,
      }),
    ]);

    // After the proposal is persisted, the catalog row is renamed.
    catalogRow.name = 'Renamed Turf Product';
    catalogRow.sku = 'RENAMED-00';

    // The priced line is a snapshot: it re-joins nothing, so what renders
    // for the customer cannot change under it.
    expect(priced.lineItems[0]?.description).toBe('Pet-Friendly Artificial Turf');
    expect(priced.lineItems[0]?.sku).toBe('TF-PET-70');
    expect(priced.lineItems[0]?.catalogName).toBe('Pet-Friendly Artificial Turf');
  });

  it('carries no catalog identity on unmatched lines; description falls back to the normalized query', () => {
    const priced = priceProposal([
      baseItem({
        description: 'pet grass 900 sqft',
        matchMethod: 'unmatched',
        catalogItemId: null,
        sku: null,
      }),
    ]);
    const line = priced.lineItems[0];
    expect(line.sku).toBeNull();
    expect(line.catalogName).toBeNull();
    expect(line.description).toContain('pet grass 900 sqft');
    expect(line.needsReview).toBe(true);
  });
});
