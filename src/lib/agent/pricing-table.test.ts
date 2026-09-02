import { describe, expect, it } from 'vitest';

import { estimateMessageCostUsd } from './pricing-table';

describe('estimateMessageCostUsd', () => {
  it('prices bare model names', () => {
    // 1M in at $2.50 + 1M out at $10.00.
    expect(estimateMessageCostUsd('gpt-4o', 1_000_000, 1_000_000)).toBeCloseTo(12.5, 6);
  });

  it('prices dated OpenAI snapshot strings at their family rate', () => {
    // The adapter records the API's returned model string.
    expect(estimateMessageCostUsd('gpt-4o-2024-08-06', 1_254, 1_249)).toBeCloseTo(
      (1_254 / 1e6) * 2.5 + (1_249 / 1e6) * 10,
      9,
    );
    expect(estimateMessageCostUsd('gpt-4o-mini-2024-07-18', 875, 21)).toBeCloseTo(
      (875 / 1e6) * 0.15 + (21 / 1e6) * 0.6,
      9,
    );
  });

  it('returns null for unknown models instead of a fake zero', () => {
    expect(estimateMessageCostUsd('not-a-real-model', 1000, 1000)).toBeNull();
  });

  it('treats null token counts as zero', () => {
    expect(estimateMessageCostUsd('claude-sonnet-4-5', null, null)).toBe(0);
  });
});
