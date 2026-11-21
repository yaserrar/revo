import type {
  EngineKind,
  Finding,
  ModelId,
  RepoSettings,
  ScoreBreakdownRow,
  ScoreLabel,
  Severity,
  SeverityCounts,
  Verification,
} from '@revo/shared';
import type { ReviewContext } from './context';
import type { CallUsage } from './pricing';
import type { FileReader } from './related';

/** Status of a file in a PR, as GitHub reports it. */
export type ChangedFileStatus =
  'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';

export type ChangedFile = {
  /** Path in the new version. */
  path: string;
  previousPath?: string;
  status: ChangedFileStatus;
  /** Unified diff from GitHub. Missing for binary or very large files. */
  patch?: string;
  additions: number;
  deletions: number;
  /** Full new content, when fetched (used for context and snippets). */
  newContent?: string;
};

/** A file not changed by the PR but given as context (imports, Prisma schema). */
export type RelatedFile = { path: string; content: string };

export type PrInfo = { title: string; body: string };

/** The repo settings the engine needs. */
export type ReviewSettingsInput = Pick<
  RepoSettings,
  'model' | 'categories' | 'ignoreGlobs' | 'threshold' | 'maxFindings' | 'instructions'
>;

/** What an engine sees: the files kept after filtering and size limits. */
export type EngineContext = {
  pr: PrInfo;
  files: ChangedFile[];
  related: RelatedFile[];
  settings: ReviewSettingsInput;
  model: ModelId;
  /** The rendered context (PR, files, related files), within the token budget. */
  context: ReviewContext;
};

export type FindResult = { findings: Finding[]; usage: CallUsage };
export type VerifyResult = { verifications: Verification[]; usage: CallUsage };

/**
 * A review engine runs the two AI passes. `fakeEngine` is deterministic and
 * offline; the Claude engine calls the API. Engines throw on failure; the
 * caller (the worker) marks the review failed and retries.
 */
export interface ReviewEngine {
  readonly kind: EngineKind;
  /** Pass 1: find up to 10 problems in the change. */
  find(ctx: EngineContext): Promise<FindResult>;
  /** Pass 2: confirm or reject every finding of pass 1, in one call. */
  verify(ctx: EngineContext, findings: Finding[]): Promise<VerifyResult>;
}

export type ReviewInput = {
  pr: PrInfo;
  files: ChangedFile[];
  related: RelatedFile[];
  settings: ReviewSettingsInput;
  engine: ReviewEngine;
  /**
   * Reads repo files at the PR head. When given, related files (imports and
   * the Prisma schema, spec 7.4) are collected for the files kept after the
   * size limits and added to `related`.
   */
  readFile?: FileReader;
};

/** A finding ready to save and show. */
export type ReviewedFinding = Finding & {
  /** Position in its list, 0 = most important. */
  index: number;
  /** Severity from pass 1 when pass 2 lowered it. */
  originalSeverity: Severity | null;
  /** Pass 2's reason (why it was kept or rejected). */
  reason: string;
  /** Code lines for display (at most 30). */
  snippet: string;
  /** Line number of the first snippet line. */
  snippetStartLine: number;
};

export type SkippedFileReason = 'ignored' | 'removed' | 'binary' | 'size_limit';
export type SkippedFile = { path: string; reason: SkippedFileReason };

export type ReviewUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Cache-read tokens (Review.cachedTokens). */
  cachedTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

type OutcomeBase = {
  model: ModelId;
  engine: EngineKind;
  filesReviewed: number;
  filesSkipped: number;
  skippedFiles: SkippedFile[];
  /** Notes for the comment and dashboard, e.g. "Large PR: reviewed 18 of 52 files." */
  notes: string[];
  durationMs: number;
};

export type ReviewOutcome =
  | (OutcomeBase & {
      status: 'done';
      /** Confirmed findings, deduplicated, sorted by severity then confidence, capped at maxFindings. */
      findings: ReviewedFinding[];
      /** Rejected by pass 2 (or outside the change), with the reason. Never posted. */
      rejected: ReviewedFinding[];
      score: number;
      label: ScoreLabel;
      passed: boolean;
      counts: SeverityCounts;
      breakdown: ScoreBreakdownRow[];
      usage: ReviewUsage;
    })
  | (OutcomeBase & {
      status: 'skipped';
      /** `too_large`: not even one file fits in the per-pass token limit. */
      skipReason: 'no_reviewable_files' | 'too_large';
    });
