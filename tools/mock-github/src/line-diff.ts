/**
 * Unified diff between two versions of a file, like the `patch` GitHub returns
 * per PR file: hunks with 3 lines of context, no file headers.
 */

type Op = { type: ' ' | '-' | '+'; text: string };

export type FilePatch = { patch: string; additions: number; deletions: number };

const CONTEXT = 3;

function splitLines(content: string | null): string[] {
  if (content === null || content === '') return [];
  const lines = content.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/** Longest-common-subsequence edit script (files in the mock are small). */
function editScript(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: '-', text: a[i++]! });
    } else {
      ops.push({ type: '+', text: b[j++]! });
    }
  }
  while (i < n) ops.push({ type: '-', text: a[i++]! });
  while (j < m) ops.push({ type: '+', text: b[j++]! });
  return ops;
}

/** `before` null = added file, `after` null = removed file. */
export function unifiedPatch(before: string | null, after: string | null): FilePatch {
  const ops = editScript(splitLines(before), splitLines(after));
  const changed = ops.flatMap((op, idx) => (op.type === ' ' ? [] : [idx]));
  if (changed.length === 0) return { patch: '', additions: 0, deletions: 0 };

  // Group changes whose context windows touch into hunks of op indexes [from, to].
  const ranges: [number, number][] = [];
  for (const idx of changed) {
    const from = Math.max(0, idx - CONTEXT);
    const to = Math.min(ops.length - 1, idx + CONTEXT);
    const last = ranges.at(-1);
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }

  // Line numbers before each op.
  const oldAt: number[] = [];
  const newAt: number[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const op of ops) {
    oldAt.push(oldLine);
    newAt.push(newLine);
    if (op.type !== '+') oldLine++;
    if (op.type !== '-') newLine++;
  }

  const out: string[] = [];
  for (const [from, to] of ranges) {
    const slice = ops.slice(from, to + 1);
    const oldLen = slice.filter((o) => o.type !== '+').length;
    const newLen = slice.filter((o) => o.type !== '-').length;
    // An empty range starts at the line before it, as git writes it.
    const oldStart = oldLen === 0 ? oldAt[from]! - 1 : oldAt[from]!;
    const newStart = newLen === 0 ? newAt[from]! - 1 : newAt[from]!;
    out.push(`@@ -${oldStart},${oldLen} +${newStart},${newLen} @@`);
    for (const op of slice) out.push(`${op.type}${op.text}`);
  }
  return {
    patch: out.join('\n'),
    additions: ops.filter((o) => o.type === '+').length,
    deletions: ops.filter((o) => o.type === '-').length,
  };
}
