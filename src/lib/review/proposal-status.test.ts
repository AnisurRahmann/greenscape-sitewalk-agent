import { describe, expect, it } from 'vitest';

import { generationState } from './proposal-status';

describe('generationState', () => {
  it('reports generating while the pipeline has a current step', () => {
    expect(generationState({ current: 'extract', steps: { extract: 'running' } })).toEqual({
      active: true,
      step: 'extract',
    });
  });

  it('reports generating for a running step even when current is missing', () => {
    expect(generationState({ steps: { match: 'running' } })).toEqual({
      active: true,
      step: null,
    });
  });

  it('is idle once the pipeline finished — current cleared, nothing running', () => {
    // finish() clears current and marks leftovers 'skipped'.
    expect(
      generationState({ current: null, steps: { classify: 'done', extract: 'skipped' } }),
    ).toEqual({ active: false, step: null });
  });

  it('treats missing or malformed step_status as idle', () => {
    expect(generationState(null)).toEqual({ active: false, step: null });
    expect(generationState('junk')).toEqual({ active: false, step: null });
  });
});
