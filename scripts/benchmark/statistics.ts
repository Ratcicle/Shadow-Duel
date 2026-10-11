// Statistics for the benchmark harness and the Tech-Zero ablation analyzer.
// No engine imports: both analyzers load this module without a Game.
import type { Counter } from "./schema.js";

/** Two-sided 95% normal quantile. */
export const WILSON_Z_95 = 1.959963984540054;

/**
 * Win-rate convention (user decision, 11/10/2026). The only possible draw is
 * equal LP at the turn limit; it is worth DRAW_POINTS (half a point), so
 * p = (W + DRAW_POINTS·D)/n and the Wilson interval uses that fractional
 * score. Change it only here: the computations and every report text read it.
 */
export const DRAW_POINTS = 0.5;

/** DRAW_POINTS as written in reports, with the locale's decimal separator. */
export function drawPointsText(locale: "en" | "pt-BR"): string {
  const text = String(round(DRAW_POINTS, 4));
  return locale === "pt-BR" ? text.replace(".", ",") : text;
}

/** The value of a draw in words, for the PT-BR reports. */
export function drawValuePt(): string {
  if (DRAW_POINTS === 0.5) return "meio ponto";
  return `${drawPointsText("pt-BR")} ${Math.abs(DRAW_POINTS) >= 2 ? "pontos" : "ponto"}`;
}

export const WIN_RATE_RULE =
  `p = (W + ${drawPointsText("en")}·D)/n; Wilson 95% (z = ${WILSON_Z_95}) over the fractional score`;

/** Fractional score of a set of decided games (wins plus DRAW_POINTS per draw). */
export function scorePoints(wins: number, draws: number): number {
  return wins + DRAW_POINTS * draws;
}

export interface Interval {
  p: number;
  lo: number;
  hi: number;
}

/**
 * Wilson score interval. `successes` may be fractional (W + DRAW_POINTS·D);
 * n = 0 has no estimate.
 */
export function wilson(successes: number, n: number, z = WILSON_Z_95): Interval | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (!Number.isFinite(successes) || successes < 0 || successes > n) {
    throw new RangeError(`Os sucessos de Wilson devem ficar em [0, n]: ${successes}/${n}.`);
  }
  const p = successes / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export interface DifferenceInterval {
  delta: number;
  lo: number;
  hi: number;
}

/**
 * Newcombe's hybrid score interval for p1 − p2 from two independent Wilson
 * intervals: lo = d − √((p1−l1)² + (u2−p2)²), hi = d + √((u1−p1)² + (p2−l2)²).
 */
export function newcombe(first: Interval, second: Interval): DifferenceInterval {
  const delta = first.p - second.p;
  return {
    delta,
    lo: delta - Math.sqrt((first.p - first.lo) ** 2 + (second.hi - second.p) ** 2),
    hi: delta + Math.sqrt((first.hi - first.p) ** 2 + (second.p - second.lo) ** 2),
  };
}

/** Nearest-rank quantile of ascending values; null for an empty list. */
export function quantile(sortedValues: readonly number[], q: number): number | null {
  if (!sortedValues.length) return null;
  if (!(q >= 0 && q <= 1)) throw new RangeError(`O quantil deve ficar em [0, 1]: ${q}.`);
  const rank = Math.max(1, Math.ceil(q * sortedValues.length));
  return sortedValues[Math.min(rank, sortedValues.length) - 1] ?? null;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export function ascending(values: readonly number[]): number[] {
  return [...values].sort((left, right) => left - right);
}

/** Rounds for reports; JSON keeps a fixed precision so equal inputs serialize equally. */
export function round(value: number, digits = 6): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function roundOrNull(value: number | null, digits = 6): number | null {
  return value === null ? null : round(value, digits);
}

export function roundInterval(interval: Interval | null, digits = 6): Interval | null {
  return interval && { p: round(interval.p, digits), lo: round(interval.lo, digits), hi: round(interval.hi, digits) };
}

export interface Distribution {
  count: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p95: number | null;
  max: number | null;
}

export function distribution(values: readonly number[], digits = 3): Distribution {
  const sorted = ascending(values);
  return {
    count: sorted.length,
    mean: roundOrNull(mean(sorted), digits),
    p50: roundOrNull(quantile(sorted, 0.5), digits),
    p90: roundOrNull(quantile(sorted, 0.9), digits),
    p95: roundOrNull(quantile(sorted, 0.95), digits),
    max: roundOrNull(sorted.at(-1) ?? null, digits),
  };
}

// ── Counters ───────────────────────────────────────────────────────────────

export function increment(counts: Counter, key: string, amount = 1): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

export function mergeCounter(target: Counter, source: Readonly<Counter>): Counter {
  for (const [key, count] of Object.entries(source)) increment(target, key, count);
  return target;
}

/** Entries by descending count, then by key code unit. */
export function sortedEntries(counts: Readonly<Counter>): Array<[string, number]> {
  return Object.entries(counts).sort((left, right) =>
    right[1] - left[1] || (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0));
}

/** A plain copy with keys in code-unit order. */
export function sortedCounter(counts: Readonly<Counter>): Counter {
  const result: Counter = {};
  for (const key of Object.keys(counts).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))) {
    const count = counts[key];
    if (count !== undefined) result[key] = count;
  }
  return result;
}
