// @revo/github: GitHub App client, REST helpers (PRs, files, contents, checks,
// comments, reviews), webhook verification and payloads, comment rendering and
// PR gating rules. No database code. Owned by agent B.
export { GithubAppConfigSchema, githubAppConfigFromEnv, type GithubAppConfig } from './config';
export {
  RevoOctokit,
  createGithubApp,
  githubErrorStatus,
  isAppComment,
  isGithubRateLimit,
  repoRef,
  type AppIdentity,
  type GithubApp,
  type GithubClient,
  type RepoRef,
} from './client';
export {
  MAX_CONTEXT_FILE_BYTES,
  compareCommits,
  getFileContent,
  getPullRequest,
  listPullRequestFiles,
  searchCodePaths,
  type ComparedFile,
  type PullRequestFile,
  type PullRequestInfo,
} from './pulls';
export {
  FAILED_TITLE,
  REVIEWING_TITLE,
  SUPERSEDED_TITLE,
  closedCheck,
  createCheckRun,
  failedCheck,
  resultCheck,
  reviewingCheck,
  skippedCheck,
  supersededCheck,
  updateCheckRun,
  type CheckPresentation,
} from './checks';
export {
  createInlineReview,
  findSummaryComment,
  listPostedFindingComments,
  upsertSummaryComment,
  type InlineComment,
} from './comments';
export {
  codeSpan,
  findingKey,
  findingKeyFromBody,
  findingMarker,
  inlineTarget,
  isInlineSeverity,
  renderInlineComment,
  safeText,
  type InlineFinding,
  type InlineTarget,
} from './inline';
export {
  formatCost,
  formatDuration,
  formatLines,
  formatTokens,
  lineUrl,
  partialCoverage,
  renderCheckSummary,
  renderSummaryComment,
  type NotReviewedReason,
  type SummaryFinding,
  type SummaryInput,
} from './summary';
export {
  InstallationEventSchema,
  InstallationRepositoriesEventSchema,
  PullRequestEventSchema,
  PullRequestPayloadSchema,
  REVIEW_ACTIONS,
  accountType,
  createWebhookVerifier,
  deliveryIds,
  isReviewAction,
  type InstallationEvent,
  type InstallationRepositoriesEvent,
  type PullRequestEvent,
  type PullRequestPayload,
} from './webhooks';
export { REEVALUATED_SKIP_REASONS, skipReasonFor, type GateInput } from './rules';
export {
  APP_EVENTS,
  APP_PERMISSIONS,
  buildAppManifest,
  convertManifestCode,
  credentialsEnvBlock,
  manifestFormAction,
  normaliseAppUrl,
  type AppManifest,
  type ManifestConversion,
} from './manifest';
