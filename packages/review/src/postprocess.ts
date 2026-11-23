/** After pass 2 (spec 7.6): keep confirmed, remove duplicates, sort, cap. */
import {
  rangesOverlap,
  REPLACEMENT_MAX_LINES,
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
    // A one-click fix is offered only when pass 2 vouched for it.
    const { replacement, ...rest } = finding;
    return {
      ...rest,
      ...(replacement !== undefined && v.replacementSafe === true ? { replacement } : {}),
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

/**
 * A replacement GitHub can apply: the finding's lines exist in the new file,
 * there are at most REPLACEMENT_MAX_LINES of them, and the code really changes.
 * `newContent` undefined (not known) keeps nothing: the lines cannot be checked.
 */
export function usableReplacement(
  finding: Pick<Finding, 'lineStart' | 'lineEnd' | 'replacement'>,
  newContent: string | undefined,
): string | undefined {
  const { replacement, lineStart, lineEnd } = finding;
  if (replacement === undefined || newContent === undefined) return undefined;
  if (lineEnd - lineStart + 1 > REPLACEMENT_MAX_LINES) return undefined;
  const lines = newContent.split('\n');
  if (lineEnd > lines.length) return undefined;
  const original = lines.slice(lineStart - 1, lineEnd);
  const code = reindent(replacement, original);
  if (code === undefined) return undefined;
  return original.join('\n').replace(/\s+$/, '') === code.replace(/\s+$/, '') ? undefined : code;
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0];

/**
 * The replacement shifted so its first code line has the indentation of the
 * first line it replaces (models often add or drop the indent of the
 * numbered context). Every line moves by the same amount; when that is not
 * possible (tabs against spaces, a line less indented than the shift) the
 * replacement is dropped: a one-click change must not break the layout.
 */
export function reindent(replacement: string, original: readonly string[]): string | undefined {
  const lines = replacement.split('\n');
  const want = original.find((l) => l.trim() !== '');
  const have = lines.find((l) => l.trim() !== '');
  if (want === undefined || have === undefined) return replacement;
  const target = indentOf(want);
  const current = indentOf(have);
  if (target === current) return replacement;
  if (current.startsWith(target)) {
    const extra = current.slice(target.length);
    if (!lines.every((l) => l.trim() === '' || l.startsWith(extra))) return undefined;
    return lines.map((l) => (l.trim() === '' ? l : l.slice(extra.length))).join('\n');
  }
  if (target.startsWith(current)) {
    const missing = target.slice(current.length);
    return lines.map((l) => (l.trim() === '' ? l : missing + l)).join('\n');
  }
  return undefined;
}

/** Confirmed findings, deduplicated, sorted and capped. */
export function selectConfirmed<T extends JudgedFinding>(judged: readonly T[], maxFindings: number): T[] {
  return dedupeFindings(judged.filter((f) => f.confirmed)).slice(0, maxFindings);
}
