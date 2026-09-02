/** Shape of proposals.step_status written live by the orchestrator. */
export interface StepStatusDoc {
  started_at?: string;
  steps?: Record<string, string>;
  /** Step currently running; null once the pipeline finishes. */
  current?: string | null;
  error?: string;
}

export interface GenerationState {
  active: boolean;
  /** The step running right now, e.g. 'extract'; null when idle. */
  step: string | null;
}

/**
 * True while the pipeline is still producing the proposal: the orchestrator
 * clears `current` and marks no step 'running' when it finishes, so a live
 * `current` (or a running step) means generation is in flight and the list
 * should say so instead of showing a bare 'draft'.
 */
export function generationState(stepStatus: unknown): GenerationState {
  if (!stepStatus || typeof stepStatus !== 'object') return { active: false, step: null };
  const doc = stepStatus as StepStatusDoc;
  const running = Object.values(doc.steps ?? {}).some((state) => state === 'running');
  const step = doc.current ?? null;
  return { active: step != null || running, step };
}
