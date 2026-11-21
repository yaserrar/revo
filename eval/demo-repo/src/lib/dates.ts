/**
 * Date helpers. Orders are stored in UTC and reports bucket them by UTC day,
 * whatever the server's time zone is.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC of the day `date` falls on. */
export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** `YYYY-MM-DD` of the UTC day. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Parses `YYYY-MM-DD` as a UTC day, or null when malformed. */
export function parseIsoDay(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return isoDay(date) === value ? date : null;
}
