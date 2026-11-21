/**
 * Parser for the unified-diff `patch` GitHub returns per file. Pure and
 * dependency-free, used by the review engine (line numbers, snippets) and by
 * the GitHub layer (inline comments only on lines that are in the diff).
 */

export type DiffLine =
  | { type: 'add'; content: string; newLine: number }
  | { type: 'del'; content: string; oldLine: number }
  | { type: 'context'; content: string; oldLine: number; newLine: number };

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second @@, often the enclosing function. */
  section: string;
  lines: DiffLine[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] ?? '',
        lines: [],
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      continue;
    }
    if (!current || raw.startsWith('\\')) continue;
    const marker = raw[0];
    const content = raw.slice(1);
    if (marker === '+') {
      current.lines.push({ type: 'add', content, newLine: newLine++ });
    } else if (marker === '-') {
      current.lines.push({ type: 'del', content, oldLine: oldLine++ });
    } else if (marker === ' ' || raw === '') {
      // A blank line inside a hunk is an empty context line whose leading space was trimmed.
      if (raw === '' && newLine >= current.newStart + current.newLines) continue;
      current.lines.push({ type: 'context', content, oldLine: oldLine++, newLine: newLine++ });
    }
  }
  return hunks;
}

/** New-file line numbers that GitHub accepts for a review comment (added or context lines). */
export function commentableLines(patch: string | null | undefined): Set<number> {
  const lines = new Set<number>();
  for (const hunk of parsePatch(patch)) {
    for (const line of hunk.lines) if (line.type !== 'del') lines.add(line.newLine);
  }
  return lines;
}

/** New-file line numbers added by the patch. */
export function addedLines(patch: string | null | undefined): Set<number> {
  const lines = new Set<number>();
  for (const hunk of parsePatch(patch)) {
    for (const line of hunk.lines) if (line.type === 'add') lines.add(line.newLine);
  }
  return lines;
}

/** Number of added + deleted lines in a patch. */
export function changedLineCount(patch: string | null | undefined): number {
  let count = 0;
  for (const hunk of parsePatch(patch)) {
    for (const line of hunk.lines) if (line.type !== 'context') count++;
  }
  return count;
}

/** True when lines [a1, a2] and [b1, b2] overlap. */
export function rangesOverlap(a1: number, a2: number, b1: number, b2: number): boolean {
  return a1 <= b2 && b1 <= a2;
}
