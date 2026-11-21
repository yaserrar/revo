import { describe, expect, it } from 'vitest';
import { shapeCost, shapeFindingsByCategory, shapePrecision, shapeScoreByRepo } from './trends.shape';

const d = (key: string) => new Date(`${key}T00:00:00Z`);
const keys = ['2026-11-19', '2026-11-20', '2026-11-21'];

describe('shapeScoreByRepo', () => {
  it('puts each repo on its own key, null on days without a review', () => {
    const out = shapeScoreByRepo(
      keys,
      [
        { day: d('2026-11-19'), repo_id: 'a', avg_score: 72.345, reviews: 2 },
        { day: d('2026-11-21'), repo_id: 'b', avg_score: 90, reviews: 1 },
      ],
      ['a', 'b'],
    );
    expect(out).toEqual([
      { date: '2026-11-19', a: 72.3, b: null },
      { date: '2026-11-20', a: null, b: null },
      { date: '2026-11-21', a: null, b: 90 },
    ]);
  });
});

describe('shapeFindingsByCategory', () => {
  it('counts per category per bucket and drops unknown categories', () => {
    const out = shapeFindingsByCategory(
      ['2026-11-09', '2026-11-16'],
      [
        { bucket: d('2026-11-16'), category: 'bug', findings: 3 },
        { bucket: d('2026-11-16'), category: 'security', findings: 1 },
        { bucket: d('2026-11-16'), category: 'style', findings: 9 },
      ],
    );
    expect(out[0]).toEqual({
      date: '2026-11-09',
      bug: 0,
      security: 0,
      performance: 0,
      'error-handling': 0,
      data: 0,
      'missing-test': 0,
    });
    expect(out[1]).toMatchObject({ date: '2026-11-16', bug: 3, security: 1 });
    expect(Object.values(out[1]!).filter((v) => v === 9)).toHaveLength(0);
  });
});

describe('shapePrecision', () => {
  it('computes the rate per bucket and null without feedback', () => {
    expect(shapePrecision(keys, [{ bucket: d('2026-11-20'), useful: 3, wrong: 1 }])).toEqual([
      { date: '2026-11-19', useful: 0, wrong: 0, rate: null },
      { date: '2026-11-20', useful: 3, wrong: 1, rate: 0.75 },
      { date: '2026-11-21', useful: 0, wrong: 0, rate: null },
    ]);
  });
});

describe('shapeCost', () => {
  it('fills days without reviews with zero', () => {
    expect(shapeCost(keys, [{ day: d('2026-11-21'), cost: 0.1234567, reviews: 2 }])).toEqual([
      { date: '2026-11-19', costUsd: 0, reviews: 0 },
      { date: '2026-11-20', costUsd: 0, reviews: 0 },
      { date: '2026-11-21', costUsd: 0.123457, reviews: 2 },
    ]);
  });
});
