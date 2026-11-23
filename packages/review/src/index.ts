// Public interface of @revo/review. Additive changes only (see AGENTS.md).
// Node-only helpers (local file reader) live in '@revo/review/node'.
export { callerNote, contextBudgetTokens, recentNote, reviewChanges, usageNote } from './review';
export { callsOf, changedFunctions, collectCallers, importsModule, moduleName } from './callers';
export { computeScore, countBySeverity, pointsLost, type ScoreResult } from './score';
export {
  FALLBACK_MODEL_PRICES,
  MODEL_PRICES,
  ZERO_USAGE,
  addUsage,
  callCostUsd,
  isPricedModel,
  priceOf,
  roundUsd,
  usageCostUsd,
  type CallUsage,
  type ModelPrice,
} from './pricing';
export { fakeEngine } from './engines/fake';
export {
  createClaudeEngine,
  responseUsage,
  type ClaudeCallEvent,
  type ClaudeEffort,
  type ClaudeEngineOptions,
} from './engines/claude';
export {
  REVIEW_ENGINE_ERROR_CODES,
  REVIEW_ENGINE_ERROR_MESSAGES,
  ReviewEngineError,
  SUBSCRIPTION_ERROR_MESSAGES,
  isReviewEngineError,
  withEarlierUsage,
  type ReviewEngineErrorCode,
} from './errors';
export {
  compareFilePriority,
  createIgnoreMatcher,
  fileChangedLines,
  filterFiles,
  isRecent,
  largePrNote,
  looksBinary,
  looksGenerated,
  looksMinified,
  riskTier,
  selectFiles,
} from './files';
export { buildReviewContext, type ContextFileMode, type ReviewContext } from './context';
export {
  collectNameUsages,
  declaredIn,
  isDistinctiveName,
  mentions,
  removedDeclarations,
  removedNames,
  usesName,
  type NameKind,
  type NameUsage,
  type RemovedName,
  type UsageResult,
} from './usages';
export {
  candidateFiles,
  collectRelatedFiles,
  loadTsPaths,
  matchTsPaths,
  parseImportSpecifiers,
  parseJsonc,
  usesPrisma,
  type CollectRelatedOptions,
  type FileReader,
  type TsPaths,
} from './related';
export { applyPatch, isPatchApplied, renderNumberedLines, renderNumberedPatch } from './patch';
export { CHARS_PER_TOKEN, estimateTokens } from './tokens';
export { SYSTEM_PROMPT } from './prompts';
export { applyVerifications, dedupeFindings, selectConfirmed, usableReplacement } from './postprocess';
export { buildSnippet, type Snippet } from './snippet';
export { parseGitDiff } from './git-diff';
export type {
  ChangedFile,
  ChangedFileStatus,
  EngineContext,
  FindResult,
  PrInfo,
  RelatedFile,
  ReviewEngine,
  ReviewInput,
  ReviewOutcome,
  ReviewSettingsInput,
  ReviewUsage,
  ReviewedFinding,
  SkippedFile,
  SkippedFileReason,
  UsageSearch,
  VerifyResult,
} from './types';
export {
  carriedReason,
  DISMISSED_REASON,
  flaggedLines,
  locateFinding,
  reconcileWithPrior,
  type LineRange,
  type LocatedPrior,
  type PriorFinding,
  type Reconciled,
} from './track';
