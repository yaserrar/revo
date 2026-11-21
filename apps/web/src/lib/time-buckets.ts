/**
 * UTC day and week buckets that match Postgres `date_trunc('day' | 'week', ts)`
 * on UTC timestamps (weeks start on Monday). Keys are "YYYY-MM-DD".
 */
export type BucketUnit = 'day' | 'week';

const DAY_MS = 86_400_000;

export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Start of the UTC day or ISO week (Monday) containing `date`. */
export function bucketStart(date: Date, unit: BucketUnit): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (unit === 'day') return day;
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * DAY_MS);
}

/** Every bucket key from the bucket of `from` to the bucket of `to`, inclusive. */
export function bucketKeys(from: Date, to: Date, unit: BucketUnit): string[] {
  const step = unit === 'day' ? DAY_MS : 7 * DAY_MS;
  const keys: string[] = [];
  for (let t = bucketStart(from, unit).getTime(); t <= bucketStart(to, unit).getTime(); t += step) {
    keys.push(dayKey(new Date(t)));
  }
  return keys;
}

/** Midnight UTC `days - 1` days before today: a window of `days` whole days ending today. */
export function windowStart(days: number, now = new Date()): Date {
  return new Date(bucketStart(now, 'day').getTime() - (days - 1) * DAY_MS);
}

/**
 * One entry per key, in order: the row for that key when there is one,
 * otherwise `empty(key)`. Rows are matched on `keyOf(row)`.
 */
export function fillBuckets<T, R>(
  keys: readonly string[],
  rows: readonly T[],
  keyOf: (row: T) => string,
  present: (row: T, key: string) => R,
  empty: (key: string) => R,
): R[] {
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  return keys.map((key) => {
    const row = byKey.get(key);
    return row === undefined ? empty(key) : present(row, key);
  });
}

const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Nov 21" for a bucket key (UTC). */
export function formatBucket(key: string): string {
  return shortDate.format(new Date(`${key}T00:00:00Z`));
}
