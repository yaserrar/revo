import { createHash } from 'node:crypto';
import { parsePatch, SEVERITY_LABELS, type Category, type Severity } from '@revo/shared';

/**
 * Where an inline review comment goes, in GitHub's line/side form (the
 * deprecated diff `position` is not used). Lines are new-file line numbers
 * on the RIGHT side; a multi-line comment also has `startLine`.
 */
export type InlineTarget = { line: number; startLine?: number };

/**
 * Finds a place in the diff for a finding on new-file lines [lineStart, lineEnd].
 * GitHub only accepts comments on lines that appear in the patch (added or
 * context), and a multi-line comment must stay inside one hunk. Returns null
 * when no line of the range is in the diff: the finding then appears only in
 * the summary comment (spec 7.8).
 */
export function inlineTarget(
  patch: string | null | undefined,
  lineStart: number,
  lineEnd: number,
): InlineTarget | null {
  const start = Math.min(lineStart, lineEnd);
  const end = Math.max(lineStart, lineEnd);
  const hunks = parsePatch(patch).map((h) => {
    const right = new Map<number, 'add' | 'context'>();
    for (const l of h.lines) if (l.type !== 'del') right.set(l.newLine, l.type);
    return right;
  });

  // Whole range inside one hunk: a multi-line comment (or a single line).
  for (const right of hunks) {
    if (right.has(start) && right.has(end))
      return start === end ? { line: end } : { line: end, startLine: start };
  }

  // Otherwise the first added line of the range, then the first context line.
  let firstContext: number | null = null;
  for (let n = start; n <= end; n++) {
    for (const right of hunks) {
      const kind = right.get(n);
      if (kind === 'add') return { line: n };
      if (kind === 'context' && firstContext === null) firstContext = n;
    }
  }
  return firstContext === null ? null : { line: firstContext };
}

/** Only blockers and majors are commented inline (spec 7.8). */
export function isInlineSeverity(severity: Severity): boolean {
  return severity === 'blocker' || severity === 'major';
}

/**
 * Identity of a finding across reviews of one PR: file + title + category
 * (spec 3.3). Stored in a hidden marker in the inline comment so a later
 * review does not post the same comment again.
 */
export function findingKey(f: { file: string; title: string; category: string }): string {
  const normalized = [f.file, f.category, f.title.trim().replace(/\s+/g, ' ').toLowerCase()].join('\n');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

const FINDING_MARKER = /<!-- revo:finding ([0-9a-f]{16}) -->/;

export function findingMarker(key: string): string {
  return `<!-- revo:finding ${key} -->`;
}

/** Key in a comment body written by Revo, or null. */
export function findingKeyFromBody(body: string): string | null {
  return FINDING_MARKER.exec(body)?.[1] ?? null;
}

/** Zero-width space: breaks `@login` and `@org/team` so they never notify anyone. */
const ZWSP = '\u200b';

/** Markdown outside code spans: no mentions, images, raw HTML, or links other than https. */
function sanitizeProse(text: string): string {
  return (
    text
      // Images load from any host when the comment is viewed: keep only the alt text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      // Reference images (![alt][ref]) and reference definitions ([ref]: url) behave the same.
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/^( {0,3})\[([^\]]+)\]:/gm, '$1\\[$2]:')
      // Links: https only; anything else keeps its text.
      .replace(/\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (all, label: string, url: string) =>
        /^https:\/\//i.test(url) ? all : label,
      )
      // Raw HTML tags and autolinks (<http://…>, <img …>): shown as text.
      .replace(/<(?=[a-z/!?])/gi, '&lt;')
      .replace(/@(?=[a-z0-9])/gi, `@${ZWSP}`)
  );
}

/**
 * Makes text from the model (which a PR author can steer through the diff)
 * safe to post in a GitHub comment: Revo markers cannot be forged or closed,
 * and outside code spans there are no @mentions, images, raw HTML or non-https
 * links. Code spans are kept as written (GitHub shows them literally).
 */
export function safeText(text: string): string {
  const unmarked = text
    // A lone CR is a line ending too (CommonMark): normalise so nothing slips between lines.
    .replace(/\r\n?/g, '\n')
    .replace(/<!--/g, '&lt;!--')
    .replace(/-->/g, '--&gt;');
  return splitFencedBlocks(unmarked)
    .map((part) => (part.code ? part.text : sanitizeParagraphs(part.text)))
    .join('')
    .trim();
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** Fenced code blocks (``` or ~~~ lines) kept as written; an unclosed fence runs to the end (CommonMark). */
function splitFencedBlocks(text: string): { code: boolean; text: string }[] {
  const parts: { code: boolean; text: string }[] = [];
  const lines = text.split('\n');
  let prose: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = FENCE_OPEN.exec(lines[i]!);
    if (!open) {
      prose.push(lines[i]!);
      continue;
    }
    const marker = open[1]!;
    const close = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end]!)) end++;
    if (prose.length) parts.push({ code: false, text: `${prose.join('\n')}\n` });
    prose = [];
    parts.push({ code: true, text: `${lines.slice(i, end + 1).join('\n')}\n` });
    i = end;
  }
  if (prose.length) parts.push({ code: false, text: prose.join('\n') });
  return parts;
}

/** Code spans never cross a blank line (CommonMark), so each paragraph is split on its own. */
function sanitizeParagraphs(text: string): string {
  return text
    .split(/(\n[ \t]*\n)/)
    .map((chunk, i) => (i % 2 ? chunk : sanitizeInline(chunk)))
    .join('');
}

/**
 * Prose and code spans of one paragraph. A run of N backticks not escaped by a
 * backslash opens a span that closes at the next run of exactly N backticks;
 * without a closer the run is literal text.
 */
function sanitizeInline(text: string): string {
  const out: string[] = [];
  let proseFrom = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (text[i + n] === '`') n++;
    let slashes = 0;
    while (text[i - 1 - slashes] === '\\') slashes++;
    if (slashes % 2 === 1) {
      i += n;
      continue;
    }
    const close = new RegExp(`(?<!\`)\`{${n}}(?!\`)`, 'g');
    close.lastIndex = i + n;
    const match = close.exec(text);
    if (!match) {
      i += n;
      continue;
    }
    out.push(sanitizeProse(text.slice(proseFrom, i)), text.slice(i, match.index + n));
    i = proseFrom = match.index + n;
  }
  out.push(sanitizeProse(text.slice(proseFrom)));
  return out.join('');
}

/**
 * A code span that shows `text` literally, whatever backticks it contains:
 * the fence is one backtick longer than the longest run inside (CommonMark).
 */
export function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text.replace(/\r?\n/g, ' ')}${pad}${fence}`;
}

export type InlineFinding = {
  category: Category;
  severity: Severity;
  file: string;
  title: string;
  explanation: string;
  suggestion: string;
};

/** Markdown of one inline comment, with its hidden identity marker. */
export function renderInlineComment(f: InlineFinding): string {
  return [
    `**${SEVERITY_LABELS[f.severity].toUpperCase()} · ${f.category}** · ${safeText(f.title)}`,
    '',
    safeText(f.explanation),
    '',
    `**Fix:** ${safeText(f.suggestion)}`,
    '',
    findingMarker(findingKey(f)),
  ].join('\n');
}
