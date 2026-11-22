/**
 * Domain constants shared by every package. Values that are also Prisma enums
 * (severities, statuses, states, labels, outcomes) use the exact same strings,
 * checked at compile time in packages/db/src/enum-parity.ts.
 */

export const PRODUCT_NAME = 'Revo';

/** Name of the GitHub check run. */
export const CHECK_RUN_NAME = 'Revo';

/** Hidden marker used to find the summary comment again on each review. */
export const SUMMARY_MARKER = '<!-- revo:summary -->';

// ── Findings ────────────────────────────────────────────────────────────────

export const CATEGORIES = [
  'bug',
  'security',
  'performance',
  'error-handling',
  'data',
  'missing-test',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  bug: 'Bug',
  security: 'Security',
  performance: 'Performance',
  'error-handling': 'Error handling',
  data: 'Data',
  'missing-test': 'Missing test',
};

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  bug: 'Wrong behaviour in a real case: wrong calculation, off-by-one, missing null check.',
  security: 'Auth gaps, injection, secrets in code, data exposed to the wrong user.',
  performance: 'N+1 queries, unbounded loops or loads, work repeated on every request.',
  'error-handling': 'Errors swallowed, unhandled rejections, failures that leave bad state.',
  data: 'Data lost or corrupted: wrong migrations, races, timezones, partial writes.',
  'missing-test': 'New logic with real branching and no test covering it.',
};

/** Ordered from most to least severe. */
export const SEVERITIES = ['blocker', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const SEVERITY_LABELS: Record<Severity, string> = {
  blocker: 'Blocker',
  major: 'Major',
  minor: 'Minor',
};

/** Meaning given to the model (spec section 8). */
export const SEVERITY_DESCRIPTIONS: Record<Severity, string> = {
  blocker: 'Will break production, lose or corrupt data, or open a security hole.',
  major: 'Wrong behaviour in a real case, or a serious performance problem.',
  minor: 'A real but limited problem, like a missing edge case or a missing test for new logic.',
};

/** 0 = most severe. Use to sort findings. */
export const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2 };

// ── Score (spec section 9) ──────────────────────────────────────────────────

export const SEVERITY_POINTS: Record<Severity, number> = { blocker: 30, major: 12, minor: 4 };
/** Minors cost 12 points at most in total. */
export const MINOR_POINTS_CAP = 12;
export const DEFAULT_THRESHOLD = 70;

export const SCORE_LABELS = ['good_to_merge', 'needs_a_look', 'changes_needed'] as const;
export type ScoreLabel = (typeof SCORE_LABELS)[number];

export const SCORE_LABEL_TEXT: Record<ScoreLabel, string> = {
  good_to_merge: 'Good to merge',
  needs_a_look: 'Needs a look',
  changes_needed: 'Changes needed',
};

/** Lower bound (inclusive) of each label band. */
export const SCORE_BANDS: { label: ScoreLabel; min: number }[] = [
  { label: 'good_to_merge', min: 90 },
  { label: 'needs_a_look', min: 70 },
  { label: 'changes_needed', min: 0 },
];

/** Visual tone of a label: maps to the `good` / `warn` / `bad` colour tokens. */
export type Tone = 'good' | 'warn' | 'bad';
export const SCORE_LABEL_TONE: Record<ScoreLabel, Tone> = {
  good_to_merge: 'good',
  needs_a_look: 'warn',
  changes_needed: 'bad',
};

export function scoreLabel(score: number): ScoreLabel {
  const band = SCORE_BANDS.find((b) => score >= b.min);
  return band ? band.label : 'changes_needed';
}

export function scoreTone(score: number): Tone {
  return SCORE_LABEL_TONE[scoreLabel(score)];
}

// ── Pull requests and reviews ───────────────────────────────────────────────

export const PR_STATES = ['open', 'merged', 'closed'] as const;
export type PrState = (typeof PR_STATES)[number];
export const PR_STATE_LABELS: Record<PrState, string> = { open: 'Open', merged: 'Merged', closed: 'Closed' };

export const REVIEW_STATUSES = ['queued', 'running', 'done', 'skipped', 'failed'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  queued: 'Queued',
  running: 'Reviewing',
  done: 'Reviewed',
  skipped: 'Skipped',
  failed: 'Failed',
};

export const SKIP_REASONS = [
  'draft',
  'bot',
  'budget',
  'too_large',
  'no_reviewable_files',
  'disabled',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  draft: 'Draft pull request',
  bot: 'Opened by a bot',
  budget: 'Monthly budget reached',
  too_large: 'Too large to review',
  no_reviewable_files: 'No reviewable files',
  disabled: 'Reviews disabled for this repo',
};

export const REVIEW_TRIGGERS = ['auto', 'manual'] as const;
export type ReviewTrigger = (typeof REVIEW_TRIGGERS)[number];

export const FEEDBACK_OUTCOMES = ['useful', 'wrong'] as const;
export type FeedbackOutcome = (typeof FEEDBACK_OUTCOMES)[number];

export const ACCOUNT_TYPES = ['User', 'Organization'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** A user's role on a GitHub repo, lowest first (GitHub's `permissions` object). */
export const REPO_PERMISSIONS = ['read', 'triage', 'write', 'maintain', 'admin'] as const;
export type RepoPermission = (typeof REPO_PERMISSIONS)[number];

/** The role GitHub's `permissions` object grants (the highest flag set). */
export function repoPermissionFrom(
  flags: Partial<Record<'admin' | 'maintain' | 'push' | 'triage' | 'pull', boolean>> | undefined,
): RepoPermission {
  if (flags?.admin) return 'admin';
  if (flags?.maintain) return 'maintain';
  if (flags?.push) return 'write';
  if (flags?.triage) return 'triage';
  return 'read';
}

function atLeast(permission: RepoPermission, minimum: RepoPermission): boolean {
  return REPO_PERMISSIONS.indexOf(permission) >= REPO_PERMISSIONS.indexOf(minimum);
}

/** Repo settings (budget, model, prompt instructions…) need maintain or admin on GitHub. */
export const canEditRepoSettings = (p: RepoPermission): boolean => atLeast(p, 'maintain');

/** "Review again" (which spends the repo's budget) needs write access or more. */
export const canRequestReview = (p: RepoPermission): boolean => atLeast(p, 'write');

// ── Pipeline limits (spec 7.3, 7.4, 7.6, 14) ────────────────────────────────

/**
 * A review still queued or running this long after its last change has lost
 * its job (worker crash, Redis outage): webhooks and "Review again" may queue it again.
 */
export const REVIEW_STALE_AFTER_MS = 30 * 60_000;

/** True when a queued or running review has not moved for {@link REVIEW_STALE_AFTER_MS}. */
export function isStaleInFlight(
  review: { status: string; updatedAt: Date },
  now: Date = new Date(),
): boolean {
  return (
    (review.status === 'queued' || review.status === 'running') &&
    now.getTime() - review.updatedAt.getTime() > REVIEW_STALE_AFTER_MS
  );
}

export const REVIEW_LIMITS = {
  /**
   * Above this many changed lines (after filtering), review the files changed
   * since the last review first, then the riskiest.
   */
  maxChangedLines: 10_000,
  /** Above this many files (after filtering), same order as above. */
  maxFiles: 100,
  /** Hard limit of input tokens per pass (every selectable model has a 1M-token context window). */
  maxInputTokensPerPass: 400_000,
  /** Send the full new file when it is shorter than this. */
  fullFileMaxLines: 600,
  /** Otherwise send the changed hunks with this many lines around each. */
  hunkContextLines: 40,
  maxRelatedFiles: 5,
  /** Files outside the change that still use a name it removes or renames, on top of the related files. */
  maxUsageFiles: 3,
  /** Names searched for in files outside the change (each search is one GitHub API call). */
  maxUsageSearches: 3,
  /** Files outside the change that call a function it modifies, on top of the related files. */
  maxCallerFiles: 3,
  /** Changed modules whose importers are searched for (one GitHub API call each). */
  maxCallerSearches: 2,
  /** Findings requested from pass 1. */
  maxFindingsPass1: 10,
  /** Snippets stored for display (privacy: never full files). */
  snippetMaxLines: 30,
  /** Lines of context added around a finding's range in its snippet. */
  snippetContextLines: 3,
} as const;

/** Debounce before a review job runs, in seconds (overridable by REVIEW_DEBOUNCE_SECONDS). */
export const DEFAULT_REVIEW_DEBOUNCE_SECONDS = 90;

/** How long a user's repo-access snapshot is trusted before it is refreshed from GitHub. */
export const REPO_ACCESS_TTL_MS = 60 * 60 * 1000;

/** Bot authors skipped by default (spec 6). Any login ending in `[bot]` is also a bot. */
export const KNOWN_BOT_LOGINS = [
  'dependabot',
  'renovate',
  'github-actions',
  'snyk-bot',
  'greenkeeper',
] as const;

export function isBotLogin(login: string): boolean {
  const lower = login.toLowerCase();
  return lower.endsWith('[bot]') || (KNOWN_BOT_LOGINS as readonly string[]).includes(lower);
}

/**
 * Files never reviewed (spec 7.2), as globs (see `glob.ts`) matched against the repo
 * path (dotfiles included). Repo settings add their own globs on top.
 */
export const BUILT_IN_IGNORE_GLOBS = [
  // lockfiles
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/bun.lock',
  '**/npm-shrinkwrap.json',
  '**/Cargo.lock',
  '**/Gemfile.lock',
  '**/poetry.lock',
  '**/composer.lock',
  '**/go.sum',
  // generated folders
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/node_modules/**',
  '**/generated/**',
  // minified files, source maps, snapshots
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/__snapshots__/**',
  '**/*.snap',
  // binaries, images, fonts, media, archives
  '**/*.{png,jpg,jpeg,gif,webp,avif,ico,bmp,tiff,psd}',
  '**/*.{woff,woff2,ttf,otf,eot}',
  '**/*.{mp3,mp4,mov,webm,wav,ogg}',
  '**/*.{zip,gz,tgz,tar,rar,7z,jar,wasm,pdf,exe,dll,so,dylib,bin}',
] as const;
