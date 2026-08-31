export interface RetryOptions {
  /** Total attempts including the first (spec: 3). */
  attempts?: number;
  /** Base delay in ms; doubles each retry (exponential backoff). */
  baseMs?: number;
}

export interface RetryOutcome<T> {
  value: T;
  attempts: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry with exponential backoff, max 3 attempts by default. Throws the last
 * error after the budget is exhausted; the caller records `attempts` on the
 * outbound_events row either way.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = options.attempts ?? 3;
  const baseMs = options.baseMs ?? 500;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await fn();
      return { value, attempts: attempt };
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts) {
        await sleep(baseMs * 2 ** (attempt - 1));
      }
    }
  }
  throw Object.assign(lastError instanceof Error ? lastError : new Error(String(lastError)), {
    retryAttempts: maxAttempts,
  });
}
