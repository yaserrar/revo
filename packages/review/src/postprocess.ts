/** After pass 2 (spec 7.6): keep confirmed, remove duplicates, sort, cap. */
import {
  rangesOverlap,
  SEVERITY_RANK,
  type Category,
  type Finding,
  type Severity,
  type Verification,
} from '@revo/shared';

export type JudgedFinding = Finding & {
  originalSeverity: Severity | null;
  confirmed: boolean;
  reason: string;
};

/**
 * Applies pass 2's answers to pass 1's findings. A finding pass 2 did not
 * answer is rejected; a finding in a file outside the change, or in a
 * category the repo does not check, is rejected too.
 */
export function applyVerifications(
  findings: readonly Finding[],
  verifications: readonly Verification[],
  { reviewedPaths, categories }: { reviewedPaths: ReadonlySet<string>; categories: readonly Category[] },
): JudgedFinding[] {
  const byIndex = new Map(verifications.map((v) => [v.index, v]));
  return findings.map((finding, index) => {
    const v = byIndex.get(index);
    if (!reviewedPaths.has(finding.file)) {
      return {
        ...finding,
        originalSeverity: null,
        confirmed: false,
        reason: 'The file is not part of this change.',
      };
    }
    if (!categories.includes(finding.category)) {
      return {
        ...finding,
        originalSeverity: null,
        confirmed: false,
        reason: 'This category is not checked for this repo.',
      };
    }
    if (!v)
      return {
        ...finding,
        originalSeverity: null,
        confirmed: false,
        reason: 'Not confirmed by verification.',
      };
    const lowered =
      v.severity && SEVERITY_RANK[v.severity] > SEVERITY_RANK[finding.severity] ? v.severity : null;
    return {
      ...finding,
      severity: lowered ?? finding.severity,
      originalSeverity: lowered ? finding.severity : null,
      confirmed: v.outcome === 'confirmed',
      reason: v.reason,
    };
  });
}

export function compareFindings(a: Finding, b: Finding): number {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.confidence - a.confidence;
}

/** Same file, overlapping lines and same category: keep the most severe, then most confident. */
export function dedupeFindings<T extends Finding>(findings: readonly T[]): T[] {
  const kept: T[] = [];
  for (const f of [...findings].sort(compareFindings)) {
    const dup = kept.some(
      (k) =>
        k.file === f.file &&
        k.category === f.category &&
        rangesOverlap(k.lineStart, k.lineEnd, f.lineStart, f.lineEnd),
    );
    if (!dup) kept.push(f);
  }
  return kept;
}

/** Confirmed findings, deduplicated, sorted and capped. */
export function selectConfirmed<T extends JudgedFinding>(judged: readonly T[], maxFindings: number): T[] {
  return dedupeFindings(judged.filter((f) => f.confirmed)).slice(0, maxFindings);
}
