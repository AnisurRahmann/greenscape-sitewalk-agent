import { describe, expect, it } from 'vitest';

import { findEvidenceSpans, segmentTranscript } from './evidence';

const TRANSCRIPT =
  'Walked the backyard today.  They want a gas fire pit near the patio, and ivory travertine pavers everywhere.';

describe('findEvidenceSpans', () => {
  it('finds spans case-insensitively across collapsed whitespace', () => {
    const spans = findEvidenceSpans(TRANSCRIPT, ['they want a gas   fire pit']);
    expect(spans).toHaveLength(1);
    const [span] = spans;
    expect(TRANSCRIPT.slice(span?.start, span?.end).toLowerCase()).toBe(
      'they want a gas fire pit',
    );
  });

  it('returns nothing for evidence that is not in the transcript', () => {
    expect(findEvidenceSpans(TRANSCRIPT, ['solid granite countertops'])).toEqual([]);
  });

  it('locates multiple non-overlapping spans in transcript order', () => {
    const spans = findEvidenceSpans(TRANSCRIPT, [
      'ivory travertine pavers',
      'gas fire pit',
    ]);
    expect(spans.map((s) => s.evidence)).toEqual(['gas fire pit', 'ivory travertine pavers']);
    expect(spans[0]!.start).toBeLessThan(spans[1]!.start);
  });

  it('never produces overlapping spans', () => {
    const spans = findEvidenceSpans(TRANSCRIPT, ['gas fire pit', 'gas fire pit near']);
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.start).toBeGreaterThanOrEqual(sorted[i - 1]!.end);
    }
  });
});

describe('segmentTranscript', () => {
  it('reconstructs the transcript exactly from its segments', () => {
    const segments = segmentTranscript(TRANSCRIPT, ['gas fire pit', 'ivory travertine pavers']);
    expect(segments.map((s) => s.text).join('')).toBe(TRANSCRIPT);
    expect(segments.filter((s) => s.highlighted)).toHaveLength(2);
  });
});
