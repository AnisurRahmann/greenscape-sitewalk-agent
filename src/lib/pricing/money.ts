/**
 * The only place currency is touched. Every money value enters this module's
 * world as integer cents (via toCents) and leaves as dollars (via fromCents);
 * arithmetic between those points is integer math with one rounding at the
 * end. No float arithmetic on money anywhere else (CLAUDE.md rule 1).
 */

/** The single rounding helper: converts a dollar amount to integer cents. */
export function toCents(dollars: number): number {
  return Math.round(dollars * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

/** rateBps: basis points, 8.6% -> 860. Rounds once, to the nearest cent. */
export function centsTimesBps(cents: number, bps: number): number {
  return Math.round((cents * bps) / 10_000);
}

/** Applies a materials share (0..1) to a cents amount with one rounding. */
export function centsTimesRatio(cents: number, ratio: number): number {
  return Math.round(cents * ratio);
}
