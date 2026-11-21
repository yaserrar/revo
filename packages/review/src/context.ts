/**
 * Builds the review context (spec 7.4) and keeps it under the per-pass token
 * budget (spec 7.3). The same text is the shared, cached prefix of pass 1 and
 * pass 2.
 *
 * Per changed file: the patch, always, with new-file line numbers, plus the
 * full new version when it is under 600 lines, otherwise the changed hunks
 * with 40 lines around each. An added file shown in full skips its patch
 * (every line is added, the patch would repeat the file).
 *
 * Over budget, the lowest-priority context goes first:
 *   1. related files, last-ranked first
 *   2. full files become hunk excerpts, lowest-priority file first
 *   3. excerpts become patch only, lowest-priority file first
 *   4. whole files are dropped, lowest-priority first (never the last one)
 *   5. the last file's patch keeps its first hunks only
 */
import { parsePatch, REVIEW_LIMITS } from '@revo/shared';
import { compareFilePriority, riskTier } from './files';
import { hunkWindows, lineCount, renderNumberedLines, renderNumberedPatch } from './patch';
import { estimateTokens } from './tokens';
import type { ChangedFile, PrInfo, RelatedFile } from './types';

export type ContextFileMode = 'full' | 'excerpt' | 'patch';

export type ReviewContext = {
  /** Rendered PR, changed files and related files. */
  text: string;
  estimatedTokens: number;
  /** Files in the context, riskiest first, with how much of each is shown. */
  files: { path: string; mode: ContextFileMode; truncated: boolean }[];
  /** Related files kept. */
  related: string[];
  /** Changed files left out to fit the budget. */
  droppedFiles: string[];
};

export type BuildContextInput = {
  pr: PrInfo;
  files: readonly ChangedFile[];
  related: readonly RelatedFile[];
  /** Tokens available for this context. */
  budgetTokens: number;
};

/** PR descriptions are often long templates; the start carries the intent. */
const MAX_DESCRIPTION_CHARS = 6_000;
const PRIORITY_LABEL = { 1: 'high', 2: 'normal', 3: 'test' } as const;

type Entry = { file: ChangedFile; mode: ContextFileMode; hunks: number | null };

const attr = (value: string) => value.replace(/[\n"]/g, ' ');

function renderPr(pr: PrInfo): string {
  const body = pr.body.trim();
  const description =
    body.length > MAX_DESCRIPTION_CHARS ? `${body.slice(0, MAX_DESCRIPTION_CHARS)}\n[description cut]` : body;
  return [
    '<pull_request>',
    `<title>${pr.title.trim()}</title>`,
    `<description>\n${description || '(no description)'}\n</description>`,
    '</pull_request>',
  ].join('\n');
}

/** Keeps the first `hunks` hunks of a patch. */
function firstHunks(patch: string, hunks: number): string {
  const kept = parsePatch(patch).slice(0, hunks);
  const lines = patch.split('\n');
  const starts = lines.flatMap((l, i) => (l.startsWith('@@') ? [i] : []));
  const end = starts[kept.length] ?? lines.length;
  return lines.slice(0, end).join('\n');
}

function renderFile({ file, mode, hunks }: Entry): string {
  const head = [
    `<file path="${attr(file.path)}"`,
    file.previousPath ? ` previous_path="${attr(file.previousPath)}"` : '',
    ` status="${file.status}" priority="${PRIORITY_LABEL[riskTier(file.path)]}">`,
  ].join('');
  const parts = [head];
  const content = file.newContent;
  const showPatch = !(mode === 'full' && file.status === 'added');
  if (showPatch && file.patch) {
    const patch = hunks === null ? file.patch : firstHunks(file.patch, hunks);
    const cut = hunks === null ? '' : ' truncated="true"';
    parts.push(`<diff${cut}>\n${renderNumberedPatch(patch)}\n</diff>`);
  }
  if (content !== undefined && mode === 'full') {
    parts.push(`<new_file lines="${lineCount(content)}">\n${renderNumberedLines(content)}\n</new_file>`);
  } else if (content !== undefined && mode === 'excerpt' && file.patch) {
    const total = lineCount(content);
    const windows = hunkWindows(file.patch, total, REVIEW_LIMITS.hunkContextLines);
    const excerpts = windows.map(
      (w) => `<excerpt lines="${w.from}-${w.to}">\n${renderNumberedLines(content, w.from, w.to)}\n</excerpt>`,
    );
    parts.push(`<new_file_excerpts total_lines="${total}">\n${excerpts.join('\n')}\n</new_file_excerpts>`);
  }
  parts.push('</file>');
  return parts.join('\n');
}

function renderRelated(file: RelatedFile): string {
  return `<file path="${attr(file.path)}">\n${renderNumberedLines(file.content)}\n</file>`;
}

function initialMode(file: ChangedFile): ContextFileMode {
  if (file.newContent === undefined) return 'patch';
  if (lineCount(file.newContent) < REVIEW_LIMITS.fullFileMaxLines) return 'full';
  return file.patch ? 'excerpt' : 'full';
}

/** One step down for a file, or null when it is already at its smallest. */
function shrink(entry: Entry, mode: 'full' | 'excerpt'): ContextFileMode | null {
  if (entry.mode !== mode || !entry.file.patch) return null;
  return mode === 'full' ? 'excerpt' : 'patch';
}

export function buildReviewContext({ pr, files, related, budgetTokens }: BuildContextInput): ReviewContext {
  const entries: Entry[] = [...files]
    .sort(compareFilePriority)
    .map((file) => ({ file, mode: initialMode(file), hunks: null }));
  const keptRelated = [...related];
  const dropped: string[] = [];

  const prText = renderPr(pr);
  const fileTokens = new Map<Entry, number>();
  const tokensOf = (e: Entry) => {
    let t = fileTokens.get(e);
    if (t === undefined) {
      t = estimateTokens(renderFile(e));
      fileTokens.set(e, t);
    }
    return t;
  };
  const relatedTokens = keptRelated.map((r) => estimateTokens(renderRelated(r)));
  const wrapperTokens = estimateTokens(prText) + 40;
  const total = () =>
    wrapperTokens +
    entries.reduce((s, e) => s + tokensOf(e), 0) +
    relatedTokens.slice(0, keptRelated.length).reduce((s, t) => s + t, 0);
  const setMode = (e: Entry, mode: ContextFileMode) => {
    e.mode = mode;
    fileTokens.delete(e);
  };

  while (total() > budgetTokens) {
    if (keptRelated.length > 0) {
      keptRelated.pop();
      continue;
    }
    const step = (['full', 'excerpt'] as const)
      .map((mode) => {
        for (let i = entries.length - 1; i >= 0; i--) {
          const next = shrink(entries[i]!, mode);
          if (next) return { entry: entries[i]!, next };
        }
        return null;
      })
      .find((s) => s !== null);
    if (step) {
      setMode(step.entry, step.next);
      continue;
    }
    if (entries.length > 1) {
      dropped.push(entries.pop()!.file.path);
      continue;
    }
    const last = entries[0];
    const hunkCount = parsePatch(last?.file.patch).length;
    const current = last?.hunks ?? hunkCount;
    if (!last || current <= 1) break;
    last.hunks = current - 1;
    fileTokens.delete(last);
  }

  const sections = [prText, `<changed_files count="${entries.length}">`];
  sections.push(...entries.map(renderFile), '</changed_files>');
  if (keptRelated.length > 0) {
    sections.push(
      `<related_files count="${keptRelated.length}">`,
      ...keptRelated.map(renderRelated),
      '</related_files>',
    );
  }
  const text = sections.join('\n\n');
  return {
    text,
    estimatedTokens: estimateTokens(text),
    files: entries.map((e) => ({ path: e.file.path, mode: e.mode, truncated: e.hunks !== null })),
    related: keptRelated.map((r) => r.path),
    droppedFiles: dropped,
  };
}
