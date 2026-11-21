/** Display formatting shared by every screen. Pure functions (tested in format.test.ts). */

const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usd4 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 3,
  maximumFractionDigits: 4,
});
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('en-US');

/** $0.18 for normal amounts, $0.0042 for sub-cent amounts. */
export function formatUsd(value: number): string {
  if (value !== 0 && Math.abs(value) < 0.01) return usd4.format(value);
  return usd2.format(value);
}

/** 48.2k tokens */
export function formatTokens(value: number): string {
  return value < 10_000 ? integer.format(value) : compact.format(value).toLowerCase();
}

export function formatInt(value: number): string {
  return integer.format(value);
}

/** 0.873 → "87%" */
export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 41 s, 1 min 05 s */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
}

export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** "line 18" or "lines 44–52" */
export function formatLines(start: number, end: number): string {
  return start === end ? `line ${start}` : `lines ${start}–${end}`;
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago", "yesterday", "just now" */
export function formatRelative(date: string | Date, now: Date = new Date()): string {
  const seconds = Math.round((new Date(date).getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

export function formatDate(date: string | Date): string {
  return dateFmt.format(new Date(date));
}

export function formatDateTime(date: string | Date): string {
  return dateTimeFmt.format(new Date(date));
}
