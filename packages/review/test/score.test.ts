import { describe, expect, it } from 'vitest';
import type { Severity } from '@revo/shared';
import { computeScore, pointsLost } from '../src/score';

const many = (severity: Severity, n: number) => Array.from({ length: n }, () => ({ severity }));

describe('computeScore', () => {
  it('gives 100, good to merge and a green check with no findings', () => {
    const r = computeScore([]);
    expect(r).toMatchObject({ score: 100, label: 'good_to_merge', tone: 'good', passed: true });
    expect(r.breakdown).toEqual([
      { severity: 'blocker', count: 0, points: 0 },
      { severity: 'major', count: 0, points: 0 },
      { severity: 'minor', count: 0, points: 0 },
    ]);
  });

  it('takes 30 points per blocker and always fails the check', () => {
    const r = computeScore(many('blocker', 1));
    expect(r).toMatchObject({ score: 70, label: 'needs_a_look', passed: false });
  });

  it('takes 12 points per major', () => {
    expect(computeScore(many('major', 1))).toMatchObject({ score: 88, label: 'needs_a_look', passed: true });
    expect(computeScore(many('major', 2))).toMatchObject({ score: 76, passed: true });
    expect(computeScore(many('major', 3))).toMatchObject({
      score: 64,
      label: 'changes_needed',
      passed: false,
    });
  });

  it('takes 4 points per minor, capped at 12 in total', () => {
    expect(computeScore(many('minor', 1)).score).toBe(96);
    expect(computeScore(many('minor', 2)).score).toBe(92);
    expect(computeScore(many('minor', 3)).score).toBe(88);
    expect(computeScore(many('minor', 7)).score).toBe(88);
    expect(computeScore(many('minor', 7)).breakdown[2]).toEqual({ severity: 'minor', count: 7, points: -12 });
  });

  it('matches the spec example: 2 majors and 1 minor give 72, needs a look', () => {
    const r = computeScore([...many('major', 2), ...many('minor', 1)]);
    expect(r).toMatchObject({ score: 72, label: 'needs_a_look', tone: 'warn', passed: true });
    expect(r.breakdown).toEqual([
      { severity: 'blocker', count: 0, points: 0 },
      { severity: 'major', count: 2, points: -24 },
      { severity: 'minor', count: 1, points: -4 },
    ]);
  });

  it('never goes below 0', () => {
    expect(computeScore(many('blocker', 5)).score).toBe(0);
  });

  it('uses the label bands at their edges', () => {
    expect(computeScore([...many('minor', 2), ...many('minor', 0)]).label).toBe('good_to_merge'); // 92
    expect(computeScore([...many('major', 1)]).label).toBe('needs_a_look'); // 88
    expect(computeScore([...many('blocker', 1)]).label).toBe('needs_a_look'); // 70
    expect(computeScore([...many('blocker', 1), ...many('minor', 1)]).label).toBe('changes_needed'); // 66
  });

  it('fails the check under the repo threshold', () => {
    const findings = many('major', 1); // 88
    expect(computeScore(findings, 90).passed).toBe(false);
    expect(computeScore(findings, 88).passed).toBe(true);
    expect(computeScore(findings, 0).passed).toBe(true);
  });

  it('fails the check on a blocker even with a threshold of 0', () => {
    expect(computeScore(many('blocker', 1), 0).passed).toBe(false);
  });

  it('is independent of the order of findings', () => {
    const a = computeScore([{ severity: 'minor' }, { severity: 'major' }, { severity: 'blocker' }]);
    const b = computeScore([{ severity: 'blocker' }, { severity: 'minor' }, { severity: 'major' }]);
    expect(a).toEqual(b);
    expect(a.score).toBe(54);
  });
});

describe('pointsLost', () => {
  it('caps minors only', () => {
    expect(pointsLost('minor', 10)).toBe(12);
    expect(pointsLost('major', 10)).toBe(120);
    expect(pointsLost('blocker', 0)).toBe(0);
  });
});
