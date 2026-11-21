/**
 * Pure helpers around unified-diff patches: apply one to the old version of a
 * file, check whether it is already applied, and render it with new-file line
 * numbers for the model.
 */
import { parsePatch, type DiffHunk } from '@revo/shared';

type Lines = { lines: string[]; trailingNewline: boolean };

function toLines(text: string): Lines {
  if (text === '') return { lines: [], trailingNewline: false };
  const trailingNewline = text.endsWith('\n');
  const lines = (trailingNewline ? text.slice(0, -1) : text).split('\n');
  return { lines, trailingNewline };
}

function fromLines({ lines, trailingNewline }: Lines): string {
  if (lines.length === 0) return '';
  return lines.join('\n') + (trailingNewline ? '\n' : '');
}

const oldSide = (hunk: DiffHunk) => hunk.lines.filter((l) => l.type !== 'add').map((l) => l.content);
const newSide = (hunk: DiffHunk) => hunk.lines.filter((l) => l.type !== 'del').map((l) => l.content);

function matchesAt(lines: readonly string[], start: number, expected: readonly string[]): boolean {
  if (start < 0 || start + expected.length > lines.length) return false;
  return expected.every((content, i) => lines[start + i] === content);
}

/** First line index of a hunk side; a zero-length side starts after line `start`. */
const sideIndex = (start: number, count: number) => (count === 0 ? start : start - 1);

/**
 * Applies `patch` to `original` and returns the new text, or null when a hunk
 * does not match (the patch was made against another version).
 */
export function applyPatch(original: string, patch: string): string | null {
  const source = toLines(original);
  const hunks = parsePatch(patch);
  const out: string[] = [];
  let cursor = 0;
  for (const hunk of hunks) {
    const start = sideIndex(hunk.oldStart, hunk.oldLines);
    const expected = oldSide(hunk);
    if (start < cursor || !matchesAt(source.lines, start, expected)) return null;
    out.push(...source.lines.slice(cursor, start), ...newSide(hunk));
    cursor = start + expected.length;
  }
  out.push(...source.lines.slice(cursor));
  const trailingNewline = source.lines.length === 0 ? true : source.trailingNewline;
  return fromLines({ lines: out, trailingNewline });
}

/** True when every hunk's new side is present at its new line numbers in `content`. */
export function isPatchApplied(content: string, patch: string): boolean {
  const { lines } = toLines(content);
  const hunks = parsePatch(patch);
  return (
    hunks.length > 0 &&
    hunks.every((hunk) => matchesAt(lines, sideIndex(hunk.newStart, hunk.newLines), newSide(hunk)))
  );
}

const NUMBER_WIDTH = 5;
const num = (n: number) => String(n).padStart(NUMBER_WIDTH);
const blank = ' '.repeat(NUMBER_WIDTH);

/**
 * The patch with the NEW line number in front of every kept line:
 *
 *     @@ -10,4 +10,5 @@ export function total
 *        10   const subtotal = sum(items);
 *           - return subtotal * TAX;
 *        11 + const taxed = subtotal * TAX;
 *
 * Deleted lines have no number: findings must point at new-file lines.
 */
export function renderNumberedPatch(patch: string): string {
  const out: string[] = [];
  for (const hunk of parsePatch(patch)) {
    const section = hunk.section ? ` ${hunk.section}` : '';
    out.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@${section}`);
    for (const line of hunk.lines) {
      if (line.type === 'del') out.push(`${blank} - ${line.content}`);
      else out.push(`${num(line.newLine)} ${line.type === 'add' ? '+' : ' '} ${line.content}`);
    }
  }
  return out.join('\n');
}

/** `content` lines `from`..`to` (1-based, inclusive), each prefixed with its number. */
export function renderNumberedLines(content: string, from = 1, to = Number.POSITIVE_INFINITY): string {
  const { lines } = toLines(content);
  const last = Math.min(to, lines.length);
  const out: string[] = [];
  for (let n = Math.max(1, from); n <= last; n++) out.push(`${num(n)}   ${lines[n - 1]}`);
  return out.join('\n');
}

export function lineCount(content: string): number {
  return toLines(content).lines.length;
}

/**
 * New-file line ranges around each hunk (spec 7.4: the changed hunks with 40
 * lines around each), merged when they touch, clamped to the file.
 */
export function hunkWindows(
  patch: string,
  totalLines: number,
  context: number,
): { from: number; to: number }[] {
  const windows: { from: number; to: number }[] = [];
  for (const hunk of parsePatch(patch)) {
    const from = Math.max(1, hunk.newStart - context);
    const to = Math.min(totalLines, hunk.newStart + Math.max(hunk.newLines, 1) - 1 + context);
    if (to < from) continue;
    const prev = windows[windows.length - 1];
    if (prev && from <= prev.to + 1) prev.to = Math.max(prev.to, to);
    else windows.push({ from, to });
  }
  return windows;
}
