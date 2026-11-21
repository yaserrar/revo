/** Small pure metrics shared by services and components (tested in metrics.test.ts). */

/** Precision from feedback: useful / (useful + wrong), or null without any feedback. */
export function precisionRate(useful: number, wrong: number): number | null {
  const total = useful + wrong;
  return total === 0 ? null : useful / total;
}

/** Mean of the values, or null for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Rounds to `digits` decimals; keeps null. */
export function roundTo(value: number | null, digits = 0): number | null {
  if (value === null) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Difference `current - previous` rounded, or null when either side is missing. */
export function delta(current: number | null, previous: number | null, digits = 0): number | null {
  if (current === null || previous === null) return null;
  return roundTo(current - previous, digits);
}

export type TrendDirection = 'up' | 'down' | 'flat';

/**
 * Compares the mean of the second half of a series with the first half
 * (nulls ignored). A change under `tolerance` is flat; too few points is flat.
 */
export function trendDirection(series: readonly (number | null)[], tolerance = 2): TrendDirection {
  const half = Math.floor(series.length / 2);
  const first = mean(series.slice(0, half).filter((v): v is number => v !== null));
  const second = mean(series.slice(half).filter((v): v is number => v !== null));
  if (first === null || second === null) return 'flat';
  const diff = second - first;
  return Math.abs(diff) < tolerance ? 'flat' : diff > 0 ? 'up' : 'down';
}

/**
 * The red threshold to draw on a chart of several repos: theirs when they all
 * use the same one, null when they differ (one line would be wrong for some).
 */
export function sharedThreshold(thresholds: readonly number[]): number | null {
  const [first, ...rest] = thresholds;
  if (first === undefined) return null;
  return rest.every((t) => t === first) ? first : null;
}

/** Lower bound for a 0–100 score axis: 10 below the lowest value (and threshold), on a multiple of 10. */
export function scoreAxisFloor(values: readonly (number | null)[], threshold: number | null): number {
  const present = values.filter((v): v is number => v !== null);
  const low = Math.min(threshold ?? 100, ...present);
  return Math.max(0, Math.floor((low - 10) / 10) * 10);
}
