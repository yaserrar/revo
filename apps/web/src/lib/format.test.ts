import { describe, expect, it } from 'vitest';
import {
  formatDuration,
  formatLines,
  formatPercent,
  formatRelative,
  formatTokens,
  formatUsd,
  shortSha,
} from './format';

describe('format', () => {
  it('formats money with sub-cent precision', () => {
    expect(formatUsd(0.18)).toBe('$0.18');
    expect(formatUsd(12)).toBe('$12.00');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(0)).toBe('$0.00');
  });

  it('formats tokens, percents, durations and lines', () => {
    expect(formatTokens(4_800)).toBe('4,800');
    expect(formatTokens(48_200)).toBe('48.2k');
    expect(formatPercent(0.873)).toBe('87%');
    expect(formatDuration(41_000)).toBe('41 s');
    expect(formatDuration(65_000)).toBe('1 min 05 s');
    expect(formatLines(18, 18)).toBe('line 18');
    expect(formatLines(44, 52)).toBe('lines 44–52');
    expect(shortSha('a9c4f2d0b1')).toBe('a9c4f2d');
  });

  it('formats relative times', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    expect(formatRelative('2026-11-21T11:59:40Z', now)).toBe('just now');
    expect(formatRelative('2026-11-21T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatRelative('2026-11-20T12:00:00Z', now)).toBe('yesterday');
  });
});
