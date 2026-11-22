import {
  CATEGORY_LABELS,
  MINOR_POINTS_CAP,
  PRODUCT_NAME,
  REVIEW_LIMITS,
  SCORE_BANDS,
  SCORE_LABEL_TEXT,
  SEVERITY_LABELS,
  SEVERITY_POINTS,
  SUMMARY_MARKER,
  languageForPath,
  scoreTone,
  type Category,
  type ScoreBreakdownRow,
  type ScoreLabel,
  type Severity,
} from '@revo/shared';
import { codeSpan, safeText } from './inline';

export type SummaryFinding = {
  category: Category;
  severity: Severity;
  file: string;
  lineStart: number;
  lineEnd: number;
  title: string;
  explanation: string;
  suggestion: string;
  /** 0–1, from the model. */
  confidence?: number;
  /** Severity before the second pass lowered it. */
  originalSeverity?: Severity | null;
  /** Code around the finding (from the repo at the head commit, not from the model). */
  snippet?: string;
  /** Line number of the snippet's first line. */
  snippetStartLine?: number;
  /** Link to the inline comment thread, when the finding was also posted on its line. */
  inlineUrl?: string;
};

/** Why a changed file was not reviewed (same values as `@revo/review`). */
export type NotReviewedReason = 'ignored' | 'removed' | 'binary' | 'size_limit' | 'token_budget';

export type SummaryInput = {
  score: number;
  label: ScoreLabel;
  /** The check passed: no blocker and score ≥ threshold. */
  passed: boolean;
  threshold: number;
  /** Score of the previous review of this PR, for "Previous review: 58 → 72". */
  previousScore: number | null;
  breakdown: ScoreBreakdownRow[];
  /** Confirmed findings, in order (at most `maxFindings`). */
  findings: SummaryFinding[];
  /** The repo's cap on posted findings. */
  maxFindings: number;
  /** Possible problems that were dismissed: counted here, listed only in the dashboard (spec 3.2). */
  rejectedCount: number;
  /** Categories this repo checks. */
  categories: Category[];
  /** Paths of the files that were reviewed. */
  reviewedFiles: string[];
  /** Changed files that were not reviewed, with the reason. */
  notReviewed: { path: string; reason: NotReviewedReason }[];
  /** Every changed file of the PR and its added + deleted lines. */
  changedFiles: number;
  changedLines: number;
  /** e.g. "Large PR: reviewed 18 of 52 files." */
  notes: string[];
  /** "Claude Sonnet 5.5" (or the offline test engine). */
  modelName: string;
  /** Who paid, after the model in the footer: "on Revo's free tier (3 of 20 reviews this month)". */
  paidBy?: string | null;
  trigger: 'auto' | 'manual';
  durationMs: number;
  /** Input tokens including cache writes and reads, as on the dashboard. */
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** The commit that was reviewed. */
  headSha: string;
  /** https://github.com/<owner>/<repo>, for links to commits and lines. */
  repoUrl: string;
  dashboardUrl: string;
  settingsUrl: string;
};

const MINUS = '−';
const ZWSP = '​';
/** GitHub refuses comment bodies over 65,536 characters (check summaries: 65,535). */
const MAX_BODY_CHARS = 60_000;
/** Paths listed per group before "and N more". */
const MAX_LISTED = 40;
const MAX_PATH_CHARS = 120;
/** Code lines shown around a finding, and their width. */
const CONTEXT_LINES = 3;
const MAX_EXCERPT_LINES = 16;
const MAX_EXCERPT_LINE_CHARS = 180;

const SEVERITY_ICON: Record<Severity, string> = { blocker: '🔴', major: '🟠', minor: '🟡' };
const TONE_ICON = { good: '🟢', warn: '🟡', bad: '🔴' } as const;
const COUNT_NOUN: Record<Severity, [string, string]> = {
  blocker: ['blocker', 'blockers'],
  major: ['major', 'majors'],
  minor: ['minor', 'minors'],
};
const NOT_REVIEWED_LABELS: Record<NotReviewedReason, string> = {
  size_limit: 'Over the size limit',
  token_budget: 'Did not fit in the token limit of one review pass',
  ignored:
    'Skipped by ignore rules (lockfiles, generated or minified code, images and other assets, or the repo’s patterns)',
  removed: 'Deleted in this PR',
  binary: 'Binary, or no diff from GitHub (e.g. renamed without changes)',
};
/** Short form for the one-line coverage sentence. */
const NOT_REVIEWED_SHORT: Record<NotReviewedReason, string> = {
  size_limit: 'over the size limit',
  token_budget: 'over the token limit',
  ignored: 'skipped by ignore rules',
  removed: 'deleted in this PR',
  binary: 'binary or without a diff',
};
const NOT_REVIEWED_ORDER: NotReviewedReason[] = [
  'size_limit',
  'token_budget',
  'ignored',
  'removed',
  'binary',
];

/** How much of the comment fits: each level drops more detail to stay under GitHub's limit. */
type Detail = 'full' | 'no_excerpts' | 'table_only' | 'no_file_lists';
const DETAIL_LEVELS: Detail[] = ['full', 'no_excerpts', 'table_only', 'no_file_lists'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const thousands = (n: number) => n.toLocaleString('en-US');

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

export function formatCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}

export function formatLines(lineStart: number, lineEnd: number): string {
  return lineStart === lineEnd ? `line ${lineStart}` : `lines ${lineStart}–${lineEnd}`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

const shortSha = (sha: string) => sha.slice(0, 7);

/** Link to lines of a file at the reviewed commit (GitHub highlights them). */
export function lineUrl(repoUrl: string, sha: string, path: string, lineStart: number, lineEnd: number) {
  const file = path.split('/').map(encodeURIComponent).join('/');
  const lines = lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}-L${lineEnd}`;
  return `${repoUrl.replace(/\/$/, '')}/blob/${sha}/${file}#${lines}`;
}

/** Model text inside a table cell: sanitized, one line, pipes escaped. */
function cell(text: string): string {
  return safeText(text).replace(/\n+/g, ' ').replace(/\|/g, '\\|');
}

/**
 * Model text inside raw HTML (<summary>), where Markdown is not parsed: escaped
 * as HTML, mentions broken everywhere, `code` shown as <code>.
 */
function htmlText(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/@(?=[a-z0-9])/gi, `@${ZWSP}`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .trim();
}

/** A long path keeps its start and its file name. */
function shortPath(path: string): string {
  if (path.length <= MAX_PATH_CHARS) return path;
  const keep = MAX_PATH_CHARS - 1;
  return `${path.slice(0, Math.ceil(keep / 2))}…${path.slice(path.length - Math.floor(keep / 2))}`;
}

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  if (n < 0) return `${MINUS}${Math.abs(n)}`;
  return '±0';
}

function countOf(rows: ScoreBreakdownRow[], severity: Severity): number {
  return rows.find((r) => r.severity === severity)?.count ?? 0;
}

const overLimitCount = (input: SummaryInput) =>
  input.notReviewed.filter((f) => f.reason === 'size_limit' || f.reason === 'token_budget').length;
const reviewableCount = (input: SummaryInput) => input.reviewedFiles.length + overLimitCount(input);
const isPartial = (input: SummaryInput) => overLimitCount(input) > 0;

/** "10 of 69 files reviewed" for check titles; null when every reviewable file was read. */
export function partialCoverage(input: SummaryInput): string | null {
  return isPartial(input)
    ? `${input.reviewedFiles.length} of ${reviewableCount(input)} files reviewed`
    : null;
}

/** "❌ Check failed: …" with the reason, or "✅ Check passed". */
function checkLine(input: SummaryInput): string {
  const blockers = countOf(input.breakdown, 'blocker');
  const scope = isPartial(input) ? ', on the reviewed files only' : '';
  if (input.passed)
    return `✅ **Check passed**: no blockers and the score is at or above the repo’s threshold of ${input.threshold}${scope}.`;
  if (blockers > 0)
    return `❌ **Check failed**: ${plural(blockers, 'blocker')} found. Any blocker fails the check, whatever the score.`;
  return `❌ **Check failed**: the score is under the repo’s threshold of ${input.threshold}.`;
}

function partialWarning(input: SummaryInput): string[] {
  if (!isPartial(input)) return [];
  const overLimits = input.notReviewed.some((f) => f.reason === 'size_limit');
  const why = overLimits
    ? `${PRODUCT_NAME} reviews up to ${thousands(REVIEW_LIMITS.maxChangedLines)} changed lines or ${REVIEW_LIMITS.maxFiles} files per PR ` +
      '(after skipping lockfiles and generated code)'
    : `The reviewed files filled the ${thousands(REVIEW_LIMITS.maxInputTokensPerPass)}-token limit of one review pass`;
  return [
    `⚠️ **Partial review: ${input.reviewedFiles.length} of ${reviewableCount(input)} files.** ` +
      `This PR changes ${thousands(input.changedLines)} lines in ${plural(input.changedFiles, 'file')}. ` +
      `${why}: files changed since the last review first, then the highest-risk paths. ` +
      'The score covers only the reviewed files: split the PR for a full review.',
    '',
  ];
}

function metaLine(input: SummaryInput): string {
  const commit = `Reviewed commit [${codeSpan(shortSha(input.headSha))}](${input.repoUrl.replace(/\/$/, '')}/commit/${input.headSha})`;
  if (input.previousScore === null) return commit;
  const delta = input.score - input.previousScore;
  return `${commit} · Previous review: ${input.previousScore} → ${input.score} (${signed(delta)})`;
}

function overviewTable(input: SummaryInput): string[] {
  const files = isPartial(input)
    ? `${input.reviewedFiles.length} of ${reviewableCount(input)}`
    : String(input.reviewedFiles.length);
  return [
    '| Score | Blockers | Majors | Minors | Files reviewed |',
    '|:---:|:---:|:---:|:---:|:---:|',
    `| **${input.score}** / 100 | ${countOf(input.breakdown, 'blocker')} | ${countOf(input.breakdown, 'major')} | ${countOf(input.breakdown, 'minor')} | ${files} |`,
  ];
}

/** "Score: 100 − 30 (1 blocker) − 12 (1 major) = 58", minors noted when capped. */
function equation(input: SummaryInput): string {
  const parts = input.breakdown
    .filter((r) => r.count > 0)
    .map((r) => {
      const capped = r.severity === 'minor' && r.count * SEVERITY_POINTS.minor > MINOR_POINTS_CAP;
      const [one, many] = COUNT_NOUN[r.severity];
      return ` ${MINUS} ${Math.abs(r.points)} (${plural(r.count, one, many)}${capped ? ', capped' : ''})`;
    });
  return `**Score:** 100${parts.join('')} = **${input.score}**`;
}

function findingsTable(input: SummaryInput): string[] {
  return [
    '| # | Severity | Category | Where | Problem |',
    '|---|---|---|---|---|',
    ...input.findings.map((f, i) => {
      const lines = f.lineStart === f.lineEnd ? `${f.lineStart}` : `${f.lineStart}-${f.lineEnd}`;
      // In a table, `|` splits cells even inside a code span unless escaped.
      const label = codeSpan(`${shortPath(f.file)}:${lines}`).replace(/\|/g, '\\|');
      const where = `[${label}](${lineUrl(input.repoUrl, input.headSha, f.file, f.lineStart, f.lineEnd)})`;
      return `| ${i + 1} | ${SEVERITY_ICON[f.severity]} ${SEVERITY_LABELS[f.severity]} | ${CATEGORY_LABELS[f.category]} | ${where} | ${cell(f.title)} |`;
    }),
  ];
}

/** A fenced block GitHub highlights, with a fence no line inside can close. */
function codeBlock(code: string, path: string): string[] {
  const longest = Math.max(2, ...(code.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  return [`${fence}${languageForPath(path)}`, code, fence];
}

/** The flagged lines with a little context, cut from the stored snippet (long lines shortened). */
export function excerpt(f: SummaryFinding): { code: string; from: number; to: number } | null {
  if (!f.snippet || !f.snippetStartLine) return null;
  const lines = f.snippet.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  const last = f.snippetStartLine + lines.length - 1;
  const from = Math.max(f.snippetStartLine, f.lineStart - CONTEXT_LINES);
  let to = Math.min(last, f.lineEnd + CONTEXT_LINES);
  if (to < from) return null;
  if (to - from + 1 > MAX_EXCERPT_LINES) to = from + MAX_EXCERPT_LINES - 1;
  const code = lines
    .slice(from - f.snippetStartLine, to - f.snippetStartLine + 1)
    .map((l) => (l.length > MAX_EXCERPT_LINE_CHARS ? `${l.slice(0, MAX_EXCERPT_LINE_CHARS)} …` : l))
    .join('\n');
  return code.trim() ? { code, from, to } : null;
}

/** "**Label.** text", with the label on its own line when the text has several lines (fenced code). */
function labelled(label: string, text: string): string[] {
  const safe = safeText(text);
  return safe.includes('\n') ? [`**${label}.**`, '', safe, ''] : [`**${label}.** ${safe}`, ''];
}

function findingDetails(input: SummaryInput, detail: Detail): string[] {
  const out: string[] = [];
  input.findings.forEach((f, i) => {
    const open = f.severity === 'minor' ? '' : ' open';
    const where = formatLines(f.lineStart, f.lineEnd);
    const meta = [
      `[${codeSpan(shortPath(f.file))}, ${where}](${lineUrl(input.repoUrl, input.headSha, f.file, f.lineStart, f.lineEnd)})`,
    ];
    if (f.confidence !== undefined) meta.push(`confidence ${Math.round(f.confidence * 100)}%`);
    if (f.originalSeverity && f.originalSeverity !== f.severity)
      meta.push(`lowered from ${SEVERITY_LABELS[f.originalSeverity]} by verification`);
    if (f.inlineUrl) meta.push(`[discussed inline](${f.inlineUrl})`);
    out.push(
      `<details${open}>`,
      `<summary><b>${i + 1}. ${SEVERITY_ICON[f.severity]} ${SEVERITY_LABELS[f.severity]} · ${CATEGORY_LABELS[f.category]}: ${htmlText(f.title)}</b></summary>`,
      '',
      meta.join(' · '),
      '',
      ...labelled('Problem', f.explanation),
    );
    const ex = detail === 'full' ? excerpt(f) : null;
    if (ex) {
      out.push(
        `<sub>${formatLines(ex.from, ex.to)} · flagged: ${where}</sub>`,
        '',
        ...codeBlock(ex.code, f.file),
        '',
      );
    }
    if (f.suggestion.trim()) out.push(...labelled('Suggested fix', f.suggestion));
    out.push('</details>', '');
  });
  return out;
}

function pathList(paths: string[]): string[] {
  const shown = paths.slice(0, MAX_LISTED).map((p) => `- ${codeSpan(shortPath(p))}`);
  if (paths.length > MAX_LISTED)
    shown.push(`- …and ${paths.length - MAX_LISTED} more (listed in the dashboard)`);
  return shown;
}

function coverage(input: SummaryInput, detail: Detail): string[] {
  const reviewed = input.reviewedFiles.length;
  const out = ['### Coverage', ''];
  out.push(
    isPartial(input)
      ? `${reviewed} of ${reviewableCount(input)} reviewable files reviewed (see the warning above).`
      : `All ${plural(reviewed, 'reviewable file')} reviewed.`,
  );
  if (input.notReviewed.length > 0) {
    const reasons = NOT_REVIEWED_ORDER.map((reason) => {
      const n = input.notReviewed.filter((f) => f.reason === reason).length;
      return n ? `${n} ${NOT_REVIEWED_SHORT[reason]}` : null;
    }).filter(Boolean);
    out.push(
      `${plural(input.notReviewed.length, 'other changed file')} not reviewed: ${reasons.join(', ')}.`,
    );
  }
  for (const note of input.notes) if (!note.startsWith('Large PR:')) out.push('', note);
  if (detail === 'no_file_lists') return out;
  out.push(
    '',
    `<details><summary>Reviewed files (${reviewed})</summary>`,
    '',
    ...pathList(input.reviewedFiles),
    '',
    '</details>',
  );
  if (input.notReviewed.length > 0) {
    out.push('', `<details><summary>Not reviewed (${input.notReviewed.length})</summary>`, '');
    for (const reason of NOT_REVIEWED_ORDER) {
      const paths = input.notReviewed.filter((f) => f.reason === reason).map((f) => f.path);
      if (paths.length)
        out.push(`**${NOT_REVIEWED_LABELS[reason]}** (${paths.length})`, '', ...pathList(paths), '');
    }
    out.push('</details>');
  }
  return out;
}

function scoringHelp(input: SummaryInput): string[] {
  const band = (label: ScoreLabel) => SCORE_BANDS.find((b) => b.label === label)?.min ?? 0;
  return [
    '<details><summary>How the score works</summary>',
    '',
    `Every PR starts at 100. Each confirmed problem takes points off: ${MINUS}${SEVERITY_POINTS.blocker} per blocker, ` +
      `${MINUS}${SEVERITY_POINTS.major} per major, ${MINUS}${SEVERITY_POINTS.minor} per minor (minors take off ${MINOR_POINTS_CAP} at most).`,
    '',
    `${band('good_to_merge')}+ good to merge · ${band('needs_a_look')}–${band('good_to_merge') - 1} needs a look · under ${band('needs_a_look')} changes needed. ` +
      `The check fails on any blocker or a score under ${input.threshold}.`,
    '',
    'A first pass looks for problems, then a second pass tries to prove each one wrong: only the ones that survive are posted. ' +
      `This repo posts at most ${input.maxFindings} per review.`,
    '',
    `Checked for this repo: ${input.categories.map((c) => CATEGORY_LABELS[c]).join(', ')}. Change it in the [repo settings](${input.settingsUrl}).`,
    '',
    '</details>',
  ];
}

/** Everything under the headline, shared by the PR comment and the check run summary. */
function body(input: SummaryInput, detail: Detail): string[] {
  const out = [checkLine(input), '', ...partialWarning(input), metaLine(input), '', ...overviewTable(input)];
  if (input.findings.length > 0) {
    out.push('', equation(input), '', '### Problems', '', ...findingsTable(input), '');
    if (detail === 'full' || detail === 'no_excerpts') out.push(...findingDetails(input, detail));
    else out.push(`_The details of each problem are in the [dashboard](${input.dashboardUrl})._`, '');
    if (input.findings.length >= input.maxFindings) {
      out.push(
        `_Showing the ${plural(input.findings.length, 'most important problem')}: this repo posts at most ${input.maxFindings} per review, so there may be more._`,
        '',
      );
    }
  } else {
    out.push('', `No problems found in the ${plural(input.reviewedFiles.length, 'reviewed file')}.`, '');
  }
  if (input.rejectedCount > 0) {
    out.push(
      `_${plural(input.rejectedCount, 'other possible problem')} ${input.rejectedCount === 1 ? 'was' : 'were'} dismissed ` +
        '(disproved by the second pass, outside this change, or in a category this repo does not check). ' +
        'They are not posted; the dashboard lists each one with the reason._',
      '',
    );
  }
  out.push(...coverage(input, detail), '', ...scoringHelp(input));
  return out;
}

function headline(input: SummaryInput): string {
  const partial = isPartial(input) ? ' · partial review' : '';
  return `## ${TONE_ICON[scoreTone(input.score)]} ${PRODUCT_NAME} · ${input.score}/100 · ${SCORE_LABEL_TEXT[input.label]}${partial}`;
}

function runDetails(input: SummaryInput): string {
  return [
    input.paidBy ? `${input.modelName} ${input.paidBy}` : input.modelName,
    ...(input.trigger === 'manual' ? ['run with Review again'] : []),
    formatDuration(input.durationMs),
    `${formatTokens(input.tokensIn)} tokens in, ${formatTokens(input.tokensOut)} out`,
    formatCost(input.costUsd),
    `[Open in dashboard](${input.dashboardUrl})`,
    `[Repo settings](${input.settingsUrl})`,
  ].join(' · ');
}

/** The most detailed rendering that fits GitHub's limit; cut with a note as a last resort. */
function fit(render: (detail: Detail) => string, dashboardUrl: string): string {
  for (const detail of DETAIL_LEVELS) {
    const md = render(detail);
    if (md.length <= MAX_BODY_CHARS) return md;
  }
  const note = `\n\n_Cut to fit GitHub’s size limit: the full review is in the [dashboard](${dashboardUrl})._`;
  return render('no_file_lists').slice(0, MAX_BODY_CHARS - note.length) + note;
}

/**
 * The one summary comment per PR (spec 10), found again through the hidden
 * marker and edited on every review. It is meant to be read on its own: the
 * verdict and why, every problem with its code and fix, and what was covered.
 */
export function renderSummaryComment(input: SummaryInput): string {
  return fit(
    (detail) =>
      [SUMMARY_MARKER, headline(input), '', ...body(input, detail), '', '---', runDetails(input)].join('\n'),
    input.dashboardUrl,
  );
}

/** Markdown for the check run's output summary: the same content without the marker and headline. */
export function renderCheckSummary(input: SummaryInput): string {
  return fit(
    (detail) => [...body(input, detail), '', '---', runDetails(input)].join('\n').trim(),
    input.dashboardUrl,
  );
}
