/**
 * The score formula (spec section 9). The AI never gives the score: it is
 * computed from confirmed findings, so the same findings always give the same
 * score and every point lost has a reason.
 *
 *   score = 100 − 30 per blocker − 12 per major − 4 per minor (minors capped at 12)
 *   score = max(score, 0)
 *   label: 90–100 good to merge · 70–89 needs a look · 0–69 changes needed
 *   check: red when there is a blocker or the score is under the threshold
 */
import {
  DEFAULT_THRESHOLD,
  MINOR_POINTS_CAP,
  SEVERITIES,
  SEVERITY_POINTS,
  scoreLabel,
  SCORE_LABEL_TONE,
  type ScoreBreakdownRow,
  type ScoreLabel,
  type Severity,
  type SeverityCounts,
  type Tone,
} from '@revo/shared';

export type ScoreResult = {
  score: number;
  label: ScoreLabel;
  tone: Tone;
  /** Green check when true, red when false. */
  passed: boolean;
  counts: SeverityCounts;
  /** One row per severity, in order blocker → minor; `points` is the (non-positive) change. */
  breakdown: ScoreBreakdownRow[];
};

export function countBySeverity(findings: readonly { severity: Severity }[]): SeverityCounts {
  const counts: SeverityCounts = { blocker: 0, major: 0, minor: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** Points lost for `count` findings of `severity` (a positive number). */
export function pointsLost(severity: Severity, count: number): number {
  const raw = SEVERITY_POINTS[severity] * count;
  return severity === 'minor' ? Math.min(raw, MINOR_POINTS_CAP) : raw;
}

export function computeScore(
  findings: readonly { severity: Severity }[],
  threshold: number = DEFAULT_THRESHOLD,
): ScoreResult {
  const counts = countBySeverity(findings);
  const breakdown = SEVERITIES.map((severity) => {
    const lost = pointsLost(severity, counts[severity]);
    return { severity, count: counts[severity], points: lost === 0 ? 0 : -lost };
  });
  const score = Math.max(0, 100 + breakdown.reduce((sum, row) => sum + row.points, 0));
  const label = scoreLabel(score);
  return {
    score,
    label,
    tone: SCORE_LABEL_TONE[label],
    passed: counts.blocker === 0 && score >= threshold,
    counts,
    breakdown,
  };
}
