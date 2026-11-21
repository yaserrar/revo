import { parsePatch, REVIEW_LIMITS } from '@revo/shared';
import type { ChangedFile } from './types';

export type Snippet = { snippet: string; snippetStartLine: number };

/**
 * The lines shown with a finding: its range plus a few lines around it, from
 * the new file when available, otherwise from the patch. Never more than 30
 * lines (spec 14: store only short snippets).
 */
export function buildSnippet(
  file: ChangedFile | undefined,
  lineStart: number,
  lineEnd: number,
  { context = REVIEW_LIMITS.snippetContextLines, maxLines = REVIEW_LIMITS.snippetMaxLines } = {},
): Snippet {
  const from = Math.max(1, lineStart - context);
  const to = Math.min(lineEnd + context, from + maxLines - 1);

  if (file?.newContent !== undefined) {
    const lines = file.newContent.split('\n');
    const slice = lines.slice(from - 1, Math.min(to, lines.length));
    if (slice.length > 0) return { snippet: slice.join('\n'), snippetStartLine: from };
  }

  if (file?.patch) {
    const byLine = new Map<number, string>();
    for (const hunk of parsePatch(file.patch)) {
      for (const line of hunk.lines) if (line.type !== 'del') byLine.set(line.newLine, line.content);
    }
    const numbers = [...byLine.keys()].filter((n) => n >= from && n <= to).sort((a, b) => a - b);
    if (numbers.length > 0) {
      // Keep one contiguous run so line numbers stay true.
      const run: number[] = [numbers[0]!];
      for (const n of numbers.slice(1)) {
        if (n !== run[run.length - 1]! + 1) break;
        run.push(n);
      }
      return { snippet: run.map((n) => byLine.get(n)!).join('\n'), snippetStartLine: run[0]! };
    }
  }

  return { snippet: '', snippetStartLine: lineStart };
}
