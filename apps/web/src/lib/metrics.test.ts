import { describe, expect, it } from 'vitest';
import {
  delta,
  mean,
  precisionRate,
  roundTo,
  scoreAxisFloor,
  trendDirection,
  sharedThreshold,
} from './metrics';

describe('precisionRate', () => {
  it('is useful / (useful + wrong)', () => {
    expect(precisionRate(9, 1)).toBe(0.9);
    expect(precisionRate(3, 0)).toBe(1);
    expect(precisionRate(0, 4)).toBe(0);
  });
  it('is null without feedback', () => {
    expect(precisionRate(0, 0)).toBeNull();
  });
});

describe('mean, roundTo, delta', () => {
  it('averages and keeps null for empty input', () => {
    expect(mean([70, 80, 90])).toBe(80);
    expect(mean([])).toBeNull();
  });
  it('rounds and keeps null', () => {
    expect(roundTo(72.456, 1)).toBe(72.5);
    expect(roundTo(72.5)).toBe(73);
    expect(roundTo(null)).toBeNull();
  });
  it('subtracts only when both sides exist', () => {
    expect(delta(84, 80)).toBe(4);
    expect(delta(null, 80)).toBeNull();
    expect(delta(80, null)).toBeNull();
  });
});

describe('trendDirection', () => {
  it('compares the second half with the first, ignoring gaps', () => {
    expect(trendDirection([60, 62, null, 80, 84, 86])).toBe('up');
    expect(trendDirection([90, 88, 70, null, 72])).toBe('down');
    expect(trendDirection([80, 81, 80, 81])).toBe('flat');
  });
  it('is flat when a half has no data', () => {
    expect(trendDirection([null, null, 80, 90])).toBe('flat');
    expect(trendDirection([])).toBe('flat');
  });
});

describe('scoreAxisFloor', () => {
  it('sits 10 below the lowest value or threshold, on a multiple of 10', () => {
    expect(scoreAxisFloor([82, 91, null], 70)).toBe(60);
    expect(scoreAxisFloor([41, 90], 70)).toBe(30);
    expect(scoreAxisFloor([5], 70)).toBe(0);
    expect(scoreAxisFloor([], 70)).toBe(60);
  });
});

describe('sharedThreshold', () => {
  it('is the threshold all repos share, or null when they differ', () => {
    expect(sharedThreshold([70, 70])).toBe(70);
    expect(sharedThreshold([75])).toBe(75);
    expect(sharedThreshold([70, 75])).toBeNull();
    expect(sharedThreshold([])).toBeNull();
  });
});
