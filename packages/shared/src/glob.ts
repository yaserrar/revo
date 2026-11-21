/**
 * Glob patterns for ignored files (spec 7.2), matched without regular
 * expressions. A repo's settings decide the patterns, so matching must stay
 * cheap whatever they are: the cost is at most (pattern length × path length)
 * per brace alternative, never exponential. Browser-safe (the settings form
 * validates with the same rules the worker matches with).
 *
 * Syntax, relative to the repo root, dotfiles included:
 * `*` (anything inside one folder name), `**` (a whole segment: zero or more
 * folders), `?` (one character), `[abc]` `[a-z]` `[!a]` `[^a]` (one character
 * from a set), `{a,b}` (alternatives, nestable). `{a}` without a comma is literal.
 */

export const GLOB_MAX_LENGTH = 200;
/** Upper bound on the patterns one glob expands to through `{a,b}` groups. */
export const GLOB_MAX_ALTERNATIVES = 32;

type ClassItem = string | readonly [from: string, to: string];
type Token =
  | { kind: 'char'; value: string }
  | { kind: 'any' }
  | { kind: 'star' }
  | { kind: 'class'; negate: boolean; items: ClassItem[] };
type Segment = { kind: 'globstar' } | { kind: 'tokens'; tokens: Token[] };

/** Index of the `]` closing the class that opens at `start`, or -1. */
function classEnd(p: ArrayLike<string>, start: number): number {
  let i = start + 1;
  if (p[i] === '!' || p[i] === '^') i++;
  if (p[i] === ']') i++;
  for (; i < p.length; i++) if (p[i] === ']') return i;
  return -1;
}

/** The first `{…}` group with a top-level comma: its bounds and alternatives. */
function firstBraceGroup(p: string): { start: number; end: number; parts: string[] } | null {
  for (let start = 0; start < p.length; start++) {
    if (p[start] === '[') {
      const end = classEnd(p, start);
      if (end > 0) start = end;
      continue;
    }
    if (p[start] !== '{') continue;
    let depth = 0;
    const commas: number[] = [];
    for (let i = start; i < p.length; i++) {
      const ch = p[i];
      if (ch === '[') {
        const end = classEnd(p, i);
        if (end > 0) i = end;
      } else if (ch === '{') depth++;
      else if (ch === ',' && depth === 1) commas.push(i);
      else if (ch === '}' && --depth === 0) {
        if (commas.length === 0) break;
        const bounds = [start, ...commas, i];
        const parts = bounds.slice(1).map((b, k) => p.slice(bounds[k]! + 1, b));
        return { start, end: i, parts };
      }
    }
  }
  return null;
}

/** Every pattern a glob stands for once `{a,b}` groups are expanded, or null above `limit`. */
export function expandBraces(pattern: string, limit = GLOB_MAX_ALTERNATIVES): string[] | null {
  const out: string[] = [];
  const pending = [pattern];
  while (pending.length > 0) {
    const p = pending.pop()!;
    const group = firstBraceGroup(p);
    if (!group) {
      out.push(p);
      if (out.length > limit) return null;
      continue;
    }
    const head = p.slice(0, group.start);
    const tail = p.slice(group.end + 1);
    for (let k = group.parts.length - 1; k >= 0; k--) pending.push(head + group.parts[k] + tail);
    if (pending.length + out.length > limit * 8) return null;
  }
  return out;
}

function tokenize(segment: string): Token[] {
  const chars = Array.from(segment);
  const tokens: Token[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    if (ch === '*') {
      if (tokens.at(-1)?.kind !== 'star') tokens.push({ kind: 'star' });
    } else if (ch === '?') tokens.push({ kind: 'any' });
    else if (ch === '[') {
      const end = classEnd(chars, i);
      if (end < 0) {
        tokens.push({ kind: 'char', value: ch });
        continue;
      }
      let j = i + 1;
      const negate = chars[j] === '!' || chars[j] === '^';
      if (negate) j++;
      const items: ClassItem[] = [];
      for (; j < end; j++) {
        const from = chars[j]!;
        if (chars[j + 1] === '-' && j + 2 < end) {
          items.push([from, chars[j + 2]!]);
          j += 2;
        } else items.push(from);
      }
      tokens.push({ kind: 'class', negate, items });
      i = end;
    } else tokens.push({ kind: 'char', value: ch });
  }
  return tokens;
}

function matchesToken(token: Exclude<Token, { kind: 'star' }>, ch: string): boolean {
  if (token.kind === 'any') return true;
  if (token.kind === 'char') return token.value === ch;
  const inSet = token.items.some((item) =>
    typeof item === 'string' ? item === ch : ch >= item[0] && ch <= item[1],
  );
  return inSet !== token.negate;
}

/**
 * One folder or file name against one pattern segment. Every token but `*`
 * takes exactly one character, so remembering only the last `*` is exact and
 * the loop runs at most (tokens × characters) times.
 */
function matchSegment(tokens: readonly Token[], name: string): boolean {
  const chars = Array.from(name);
  let t = 0;
  let c = 0;
  let starT = -1;
  let starC = 0;
  while (c < chars.length) {
    const token = tokens[t];
    if (token?.kind === 'star') {
      starT = t++;
      starC = c;
    } else if (token && matchesToken(token, chars[c]!)) {
      t++;
      c++;
    } else if (starT >= 0) {
      t = starT + 1;
      c = ++starC;
    } else return false;
  }
  while (tokens[t]?.kind === 'star') t++;
  return t === tokens.length;
}

function compileSegments(pattern: string): Segment[] {
  const body = pattern.startsWith('./') ? pattern.slice(2) : pattern;
  return body
    .split('/')
    .map((s): Segment => (s === '**' ? { kind: 'globstar' } : { kind: 'tokens', tokens: tokenize(s) }));
}

/** Pattern segments against path segments, bottom-up: (segments × parts) cells, no recursion. */
function matchPath(segments: readonly Segment[], parts: readonly string[]): boolean {
  const size = parts.length;
  let next: boolean[] = Array.from({ length: size + 1 }, (_, i) => i === size);
  for (let s = segments.length - 1; s >= 0; s--) {
    const segment = segments[s]!;
    const current: boolean[] = new Array<boolean>(size + 1).fill(false);
    for (let i = size; i >= 0; i--) {
      if (segment.kind === 'globstar') current[i] = next[i]! || (i < size && current[i + 1]!);
      else current[i] = i < size && next[i + 1]! && matchSegment(segment.tokens, parts[i]!);
    }
    next = current;
  }
  return next[0]!;
}

/**
 * A predicate that is true when a repo path matches any of the globs. A glob
 * that expands to more than {@link GLOB_MAX_ALTERNATIVES} patterns matches nothing.
 */
export function createGlobMatcher(globs: readonly string[]): (path: string) => boolean {
  const compiled = globs.flatMap((glob) => (expandBraces(glob) ?? []).map(compileSegments));
  return (path) => {
    const parts = path.split('/');
    return compiled.some((segments) => matchPath(segments, parts));
  };
}

/**
 * Why a glob is not accepted as an ignore pattern, or null when it is fine.
 * The form, the settings API and the worker all apply these rules.
 */
export function globError(pattern: string): string | null {
  const p = pattern.trim();
  if (!p) return 'Enter a pattern.';
  if (p.length > GLOB_MAX_LENGTH) return `At most ${GLOB_MAX_LENGTH} characters.`;
  if (p.startsWith('/')) return 'Use a path relative to the repo root (no leading /).';
  if (/\s/.test(p)) return 'Patterns cannot contain spaces.';
  if (p.includes('\\')) return 'Use forward slashes.';
  if (p.split('/').includes('..')) return 'Patterns cannot go above the repo root.';
  let braces = 0;
  let brackets = 0;
  for (const ch of p) {
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
    if (braces < 0 || brackets < 0) return 'Unbalanced brackets.';
  }
  if (braces !== 0 || brackets !== 0) return 'Unbalanced brackets.';
  if (/\*{3,}/.test(p)) return 'Use * or ** (not ***).';
  if (expandBraces(p) === null)
    return `Too many {…} choices (at most ${GLOB_MAX_ALTERNATIVES} combinations).`;
  return null;
}
