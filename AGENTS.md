# Revo — agent guide

Revo is a GitHub App that reviews pull requests with Claude, gives each PR an
**explainable score out of 100**, posts one summary comment (plus inline
comments for majors and blockers), and shows everything in a dashboard: repos,
PRs, findings, trends, precision from feedback, and cost.

- **Spec:** `../docs/specs/verdict-v1-spec.md` (written under the working name
  "Verdict"; the product is **Revo** everywhere: UI, code, packages `@revo/*`,
  check run `Revo`, marker `<!-- revo:summary -->`). The spec wins over other docs.
- **Differentiators:** few comments (pass 2 tries to disprove each finding, max 5
  posted), a fixed score formula, measured precision ("Useful"/"Wrong"), visible cost.
- The spec's Zod field `verdict` (confirmed/rejected) is named **`outcome`** here,
  and `Feedback.verdict` (useful/wrong) is `Feedback.outcome`.

## House rules

- Never commit, push or deploy. Never touch other folders in `asrar/` (read only).
- Never kill processes you did not start. Shared: Postgres 5433 and 5432, Redis
  6379, RabbitMQ, other apps' dev servers (3000, 3021, 3360, …).
- 16 GB machine: one web server per agent; stop every server, worker and browser
  you start before you finish.
- Real Claude spend for the whole project stays under ~$12. Default to
  `REVO_ENGINE=fake`. Never send code anywhere except the Claude API. Never print
  or log `ANTHROPIC_API_KEY`.
- Docker is not installed here: Dockerfiles and compose are written, not run.
- No TODOs, no dead code, no lorem ipsum. Typed end to end. Unit tests for pure logic.

## Ownership (parallel work)

Three agents work at the same time in this one folder. Stay in your area.

| Area                                       | Owner              | Paths                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A · Review engine + eval**               | agent A            | `packages/review/**` (internals free; see contract below), `eval/**`                                                                                                                                                                                                                                                                                                                                                                      |
| **B · GitHub App, webhook, queue, worker** | agent B            | `packages/github/**`, `apps/worker/**`, `apps/web/src/app/api/github/**`, `apps/web/src/server/modules/github/**`, `apps/web/src/server/queue/**`, `tools/mock-github/src/routes/app.ts` (new) + its registration in `tools/mock-github/src/server.ts`, `docker-compose.yml`, `apps/*/Dockerfile`                                                                                                                                         |
| **C · Dashboard**                          | agent C            | `apps/web/src/app/(app)/**`, `apps/web/src/app/(auth)/**`, `apps/web/src/app/api/**` except `auth/` and `github/`, `apps/web/src/server/modules/<feature>/**`, `apps/web/src/server/presenters/**` (new files), `apps/web/src/schemas/**`, `apps/web/src/types/**` (new files), `apps/web/src/services/api/**` (new files), `apps/web/src/hooks/**` (new files), `apps/web/src/components/<feature>/**`, `apps/web/e2e/<feature>.spec.ts` |
| **Shared (foundation)**                    | nobody exclusively | `packages/shared/**`, `packages/db/**`, `apps/web/src/components/{ui,layout,revo,shared,brand,dev-kit}/**`, `apps/web/src/app/{layout.tsx,globals.css,dev/**,api/auth/**}`, `apps/web/src/lib/**`, `apps/web/src/server/{config,http,auth,security}/**`, `apps/web/src/proxy.ts`, root configs                                                                                                                                            |

**Shared files: additive changes only.** Add exports, fields, tokens, keys,
components or variants; never rename, remove or change the meaning of existing
ones. Edit with small targeted edits (never rewrite a whole shared file: another
agent may be editing it). **Note every shared change in the "Shared changes log"
at the end of this file** (who, what, why).

**Database changes:** add fields/models to `packages/db/prisma/schema.prisma`
with small edits (additive, with defaults or nullable), then
`pnpm --filter @revo/db exec prisma migrate dev --name <a|b|c>-<what>` and
`pnpm db:generate`, and log it below. Keep `@revo/shared` constants and Prisma
enums equal (`packages/db/src/enum-parity.ts` fails typecheck otherwise).

## Layout

```
revo/
├─ apps/
│  ├─ web/        Next.js 16.3 (App Router): dashboard, webhook route, Auth.js — port 3830 dev, 3831 prod test
│  └─ worker/     BullMQ worker (Node + TS, tsx in dev, tsup bundle for prod)
├─ packages/
│  ├─ shared/     constants, Zod schemas, DTO types, job contract, diff parser (browser-safe)
│  ├─ db/         Prisma 7 schema, migrations, client factory, seed, demo fixtures
│  ├─ review/     review pipeline + score + pricing + fake engine (no GitHub code)
│  └─ github/     Octokit helpers (agent B)
├─ tools/mock-github/  stand-in for github.com + api.github.com (port 4830)
├─ eval/          eval cases + runner (pnpm eval)
├─ docker-compose.yml  Traefik + Let's Encrypt, Postgres, Redis, migrate, web, worker
└─ .env           single env file for everything (gitignored); .env.example documents it
```

Workspace packages ship **TypeScript source** (`exports: "./src/index.ts"`):
Next transpiles them (`transpilePackages`), tsx runs them, tsup bundles the
worker. Imports inside packages are relative; `apps/web` uses `~/*` → `src/*`.

## Commands

pnpm is not on PATH and `corepack enable` fails (permissions). Use:

```sh
alias pnpm="npx -y pnpm@10.34.9"   # do not start two `npx pnpm` at the same instant (npx cache race)
pnpm install
pnpm dev               # web (3830) + worker
pnpm check             # turbo: typecheck + lint + test, every package
pnpm build             # turbo build (web + worker)
pnpm db:migrate        # prisma migrate dev (revo_dev)
pnpm db:seed           # wipe + demo data (northwind-labs, 42 PRs over 30 days)
pnpm db:test:prepare   # prisma migrate deploy on revo_test (migrate reset is blocked for agents)
pnpm db:generate       # regenerate the Prisma client
pnpm review:local --diff change.patch [--repo ./checkout] [--model id] [--fake | --engine claude] [--effort high] [--title t] [--body b] [--instructions i] [--json]
pnpm eval [--engine fake|claude] [--model claude-sonnet-5-5,claude-haiku-5-5] [--only 001,101] [--effort high] [--concurrency 3] [--max-spend 3] [--label name]
pnpm mock:github       # mock GitHub on 4830
pnpm setup:local       # first run: writes .env for the mock GitHub with fresh secrets (never overwrites)
pnpm test:e2e          # web build + Playwright (starts mock 4830 + next start 3831 + its own worker)
pnpm --filter @revo/web test:e2e [e2e/pipeline.spec.ts]   # Playwright only (needs a web build)
pnpm test:claude       # one PR through the real Claude API (REVO_E2E_CLAUDE=1; needs ANTHROPIC_API_KEY)
pnpm github:app --url https://revo.example.com [--org o]  # register the GitHub App from a manifest (DEPLOY.md)
pnpm format            # prettier
```

Per package: `pnpm --filter @revo/<name> <typecheck|lint|test|build|dev>`.

## Ports and services

| What                | Where                                                                    |
| ------------------- | ------------------------------------------------------------------------ |
| web dev             | http://localhost:3830 (`pnpm --filter @revo/web dev`)                    |
| web production test | http://localhost:3831 (`pnpm --filter @revo/web build && … start`)       |
| mock GitHub         | http://localhost:4830                                                    |
| Postgres            | Homebrew on 5433, role `user`, no password; DBs `revo_dev`, `revo_test`  |
| Redis               | `redis://localhost:6379/7` (db 7), BullMQ prefix `revo`, queue `reviews` |

Next 16 dev with Turbopack can reload in loops when watched parent folders
change: prefer a production build + `next start -p 3831` for browser checks.
Delete `.next/dev` caches you create when they grow.

## Environment

All variables are in `.env.example`. Highlights:

- `DATABASE_URL`, `TEST_DATABASE_URL`, `REDIS_URL`, `APP_URL`
- `AUTH_SECRET` (Auth.js), `TOKEN_ENCRYPTION_KEY` (GitHub user tokens at rest; defaults to a key derived from `AUTH_SECRET`)
- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_SLUG`
- `GITHUB_OAUTH_BASE_URL`, `GITHUB_API_URL`: mock GitHub. Honoured outside production; in a production build only with `REVO_TEST_MODE=1` and a localhost URL.
- `ANTHROPIC_API_KEY`, `REVO_ENGINE=claude|fake` (defaults to `claude` when a key is set)
- `REVIEW_DEBOUNCE_SECONDS` (90), `LOG_LEVEL`, `WORKER_CONCURRENCY`, `REVO_ENABLE_DEV_KIT`
- Never put `NODE_ENV` in `.env` (it breaks `next build`).

## Contracts

### `@revo/shared` (browser-safe)

- **Constants** (`constants.ts`): `CATEGORIES`, `CATEGORY_LABELS`, `CATEGORY_DESCRIPTIONS`,
  `SEVERITIES`, `SEVERITY_LABELS`, `SEVERITY_DESCRIPTIONS`, `SEVERITY_RANK`, `SEVERITY_POINTS`,
  `MINOR_POINTS_CAP`, `DEFAULT_THRESHOLD`, `SCORE_LABELS`, `SCORE_LABEL_TEXT`, `SCORE_BANDS`,
  `SCORE_LABEL_TONE`, `scoreLabel(score)`, `scoreTone(score)`, `PR_STATES`, `REVIEW_STATUSES`,
  `SKIP_REASONS` (+ `_LABELS`), `REVIEW_TRIGGERS`, `FEEDBACK_OUTCOMES`, `ACCOUNT_TYPES`,
  `REVIEW_LIMITS`, `DEFAULT_REVIEW_DEBOUNCE_SECONDS`, `REPO_ACCESS_TTL_MS`, `KNOWN_BOT_LOGINS`,
  `isBotLogin()`, `BUILT_IN_IGNORE_GLOBS`, `CHECK_RUN_NAME = 'Revo'`, `SUMMARY_MARKER = '<!-- revo:summary -->'`.
- **Models** (`models.ts`): `MODEL_IDS` (`claude-sonnet-5-5` default, `claude-haiku-5-5`, `claude-opus-5-5`),
  `MODELS[id].{name,shortName,description}`, `modelName(id)`, `ENGINE_KINDS`.
- **Schemas**: `FindingSchema`, `VerificationSchema` (`outcome: confirmed|rejected`),
  `FindingsToolInputSchema`, `VerificationsToolInputSchema`, `CategorySchema`, `SeveritySchema`,
  `RepoSettingsSchema` / `RepoSettingsPatchSchema` / `DEFAULT_REPO_SETTINGS` (includes `enabled`,
  stored on `Repo.enabled`), `FeedbackBodySchema`, `PullRequestListQuerySchema`, `IdParamsSchema`,
  `ApiErrorBody`, `API_ERROR_CODES`, `Paginated<T>`, `pageMeta()`.
- **DTOs** (`dto.ts`): `UserDto`, `InstallationDto`, `RepoDto`, `RepoSettingsDto`, `FindingDto`,
  `FeedbackDto`, `ReviewDto`, `PullRequestSummaryDto`, `ScoreBreakdownRow`, `SeverityCounts`.
  Page aggregates (overview, trends) go in `apps/web/src/types/`.
- **Job contract** (`jobs.ts`): `REVIEW_QUEUE = 'reviews'`, `QUEUE_PREFIX = 'revo'`, `REVIEW_JOB_NAME = 'review'`,
  `ReviewJobPayloadSchema` / `ReviewJobPayload` (`installationGithubId, repoGithubId, repoFullName, prNumber,
headSha, trigger: auto|manual, requestedByUserId?, deliveryId?, enqueuedAt`),
  `reviewJobId(p, nonce)` (`review-<repo>-<pr>-<sha>-<trigger>-<nonce>`, unique per enqueue; idempotency per
  head SHA is the Review row), `reviewJobIdPrefix(repo)` (purge on uninstall),
  `reviewDebounceKey(repo, pr)` (`pr-<repo>-<pr>`), `REVIEW_JOB_OPTIONS` (3 attempts, exponential backoff),
  `reviewJobAddOptions(payload, debounceMs, nonce)` (BullMQ `deduplication: { id, replace, keepLastIfActive }` + `delay` for auto).
- **Globs** (`glob.ts`): `createGlobMatcher(globs)` (no regex: cost ≤ pattern × path per alternative, so a repo's
  patterns can never freeze the worker), `expandBraces`, `globError(pattern)` (form, API and worker rules),
  `GLOB_MAX_ALTERNATIVES = 32`. `@revo/review` `createIgnoreMatcher` uses it (picomatch is gone).
- **Access:** `REPO_PERMISSIONS` (`read|triage|write|maintain|admin`), `repoPermissionFrom(githubFlags)`,
  `canEditRepoSettings` (maintain+), `canRequestReview` (write+). `REVIEW_STALE_AFTER_MS` (30 min) +
  `isStaleInFlight(review)`: a queued/running review that has not moved lost its job and may be queued again.
- **Diff** (`diff.ts`): `parsePatch(patch) → DiffHunk[]`, `commentableLines(patch)`, `addedLines(patch)`,
  `changedLineCount(patch)`, `rangesOverlap()`. **Files**: `languageForPath(path)`, `splitFullName()`.

### `@revo/review` (agent A owns internals; `src/index.ts` exports are the contract)

```ts
reviewChanges(input: ReviewInput): Promise<ReviewOutcome>
type ReviewInput = { pr: { title, body }, files: ChangedFile[], related: RelatedFile[],
                     settings: ReviewSettingsInput, engine: ReviewEngine }
type ChangedFile = { path, previousPath?, status, patch?, additions, deletions, newContent? }
type ReviewSettingsInput = Pick<RepoSettings, 'model'|'categories'|'ignoreGlobs'|'threshold'|'maxFindings'|'instructions'>
interface ReviewEngine { kind: EngineKind; find(ctx): Promise<{ findings, usage }>;
                         verify(ctx, findings): Promise<{ verifications, usage }> }
type ReviewOutcome =
  | { status: 'done', findings: ReviewedFinding[] /* confirmed, deduped, sorted, ≤ maxFindings */,
      rejected: ReviewedFinding[], score, label, passed, counts, breakdown,
      usage: { inputTokens, outputTokens, cachedTokens, cacheWriteTokens, costUsd },
      model, engine, filesReviewed, filesSkipped, skippedFiles: { path, reason }[], notes, durationMs }
  | { status: 'skipped', skipReason: 'no_reviewable_files', …same metadata }
type ReviewedFinding = Finding & { index, originalSeverity, reason, snippet, snippetStartLine }
```

Also: `computeScore(findings, threshold)` (spec 9, `score.ts`), `MODEL_PRICES`, `callCostUsd(model, usage)`,
`addUsage`, `CallUsage`, `fakeEngine` (deterministic, offline; `REVO_ENGINE=fake`), `filterFiles`,
`selectFiles` (size limits + risk tiers), `riskTier`, `applyVerifications`, `dedupeFindings`,
`selectConfirmed`, `buildSnippet`, `parseGitDiff`. Engines throw on failure; the worker marks the
review `failed` and BullMQ retries. Agent A adds the Claude engine (export e.g. `createClaudeEngine({ apiKey })`),
registers it in `src/cli/review-local.ts` and `eval/src/run.ts`, and may add `@anthropic-ai/sdk`.

**Claude engine and context (agent A, 2026-11-21; all additive):**

- `createClaudeEngine({ apiKey?, client?, effort? = 'high', maxTokens? = 16000, onCall? })` → `ReviewEngine`
  (`kind: 'claude'`). Model = `settings.model`. Both passes send the same tools, cached system prompt, repo
  instructions and cached context (pass 2 reads pass 1's cache); adaptive thinking at a pinned effort;
  server-side refusal fallback (`fallbacks: 'default'`, beta `server-side-fallback-2026-07-01`). `onCall(event)`
  gives `{ pass, attempt, model, servedBy, stopReason, durationMs, usage }` per API call (no code) for pino.
- Errors: `ReviewEngineError { code, retryable, pass, usage, message }`, `isReviewEngineError(err)`,
  `REVIEW_ENGINE_ERROR_CODES` = `refusal | max_tokens | invalid_output | rate_limited | unavailable | auth | bad_request`,
  `REVIEW_ENGINE_ERROR_MESSAGES[code]` (short user-facing text). **Worker:** retry only when `err.retryable`
  (else BullMQ `UnrecoverableError`); store `err.message`; `err.usage?.costUsd` is spend already billed.
- `ReviewInput.readFile?: (path) => Promise<string | null>` (repo file at the PR head; null when missing).
  **Worker: pass a GitHub contents reader** (`repos.getContent` at `headSha`, decode base64, null on 404). The
  pipeline then collects up to 5 related files (relative imports, tsconfig `paths`, the Prisma schema when a
  changed file uses Prisma) for the files kept after size limits; ≤ 60 reads per review. Also give
  `ChangedFile.newContent` for changed files (fetch at `headSha`) for full-file context and snippets.
- `ReviewOutcome` skipped `skipReason` may now be `'too_large'` (not even one file fits the per-pass token
  limit, `REVIEW_LIMITS.maxInputTokensPerPass`; maps to `SkipReason.too_large`). Files dropped for the token
  budget appear in `skippedFiles` with `reason: 'token_budget'` (over the line/file limits: `'size_limit'`)
  and the note `Large PR: reviewed X of Y files.`
- **Limits and incremental reviews (2026-11-22):** `REVIEW_LIMITS` = 10,000 changed lines, 100 files,
  400k tokens per pass (`max_tokens` 32k above 150k context tokens, 10-min request timeout).
  `ChangedFile.sinceLastReview?: { patch? }` marks files changed since the PR's last done review (worker:
  `lastReviewedSha` + `compareCommits`, null on force-push, rebase or a merge commit in the range): reviewed
  first (`compareFilePriority`), shown with `changed_since_last_review="true"` and `<latest_push_diff>`, note
  `recentNote(n)`. Removed names (`usages.ts`): renamed keys (deleted key line replaced by a new key at the
  same indent in the same hunk), removed exports and methods; users in the context listed in
  `<removed_names>`; `ReviewInput.searchUsages` (worker: `searchCodePaths`, GitHub code search) adds up to
  3 outside users as related files with a `reason`, note `usageNote(paths)`.
- `CallUsage.costUsd?` (exact cost when the engine computed it, e.g. a fallback model ran); `usageCostUsd(model, usage)`,
  `priceOf(model)`, `FALLBACK_MODEL_PRICES`. `outcome.usage.costUsd` already includes this.
- Also exported: `buildReviewContext`, `ReviewContext` (`EngineContext.context`), `contextBudgetTokens`,
  `collectRelatedFiles`, `parseImportSpecifiers`, `loadTsPaths`, `matchTsPaths`, `parseJsonc`, `usesPrisma`,
  `candidateFiles`, `FileReader`, `applyPatch`, `isPatchApplied`, `renderNumberedPatch`, `renderNumberedLines`,
  `estimateTokens`, `CHARS_PER_TOKEN`, `SYSTEM_PROMPT`, `looksBinary`, `looksGenerated`, `looksMinified`,
  `compareFilePriority`, `largePrNote`, `fileChangedLines`, `responseUsage`.
- Node-only subpath `@revo/review/node`: `createDirectoryReader(root, overlay?)` (local `FileReader`; used by the CLI and eval).
- Eval: `eval/demo-repo` (Harbor Goods, Next-style API + Prisma) and `eval/cases/<id>/{case.json,change.patch}`
  (10 bug PRs, 5 clean). Results in `eval/results/<stamp>-<engine>[-label].{json,md}`; real spend appended to
  `eval/results/spend.jsonl`. `eval/demo-repo` is in `.prettierignore` (patches depend on its exact bytes).

### `@revo/db`

- `createPrismaClient({ connectionString?, log? })`, everything from the generated client
  (`PrismaClient`, `Prisma`, model types, enums), `@revo/db/enums` (enum objects only),
  `@revo/db/fixtures` (demo ids: `DEMO_INSTALLATION`, `DEMO_REPOS`, `DEMO_USER`, `DEMO_USER_LIMITED`,
  `DEMO_ACCESS`, `DEMO_AUTHORS`), helpers `decimalToNumber`, `bigintToNumber`, `startOfUtcMonth`.
- Models: `User` (encrypted GitHub token columns, `accessCheckedAt`), `RepoAccess {userId, repoId, checkedAt}`,
  `Installation`, `Repo` (`enabled`), `RepoSettings`, `PullRequest`, `Review` (denormalised `repoId`,
  `@@unique([pullRequestId, headSha])`, `skippedFiles`, `notes`, `trigger`), `Finding`
  (`index`, `originalSeverity`, `snippetStartLine`, `verified`), `Feedback {outcome, note}`, `WebhookDelivery`.
- Enums (Prisma = shared): `AccountType`, `PrState`, `ReviewStatus`, `SkipReason`, `ReviewTrigger`,
  `ScoreLabel`, `Severity`, `FeedbackOutcome`. `Finding.category` and `RepoSettings.categories` are
  strings validated with `CategorySchema`. GitHub ids are `BigInt` (`bigintToNumber` in presenters).
  Money is `Decimal` (`decimalToNumber`).
- `onDelete: Cascade` from `Installation` down to `Feedback` and `RepoAccess` (spec 14).

### `apps/web` server

- `~/server/config/env` (`env`, `githubSignInEnabled`, `devKitEnabled`), `~/server/config/prisma`
  (`prisma` singleton), `~/server/config/logger` (pino; never log tokens or code).
- `~/server/http/route` — `route({ auth?: 'user'|'public', params?, query?, body?, status?, rateLimit? }, handler)`.
  Handler ctx: `{ req, user, access: { repoIds(), assertRepo(repoId) }, params, query, body }`.
  Return a value (JSON), `undefined` (204) or a `Response`. Errors become `ApiErrorBody`.
- `~/server/http/errors` — `HttpError`, `badRequest`, `unauthorized`, `forbidden`, `notFound(what)`,
  `conflict`, `unprocessable`, `rateLimited`, `budgetReached`. `~/server/http/rate-limit` —
  `assertRateLimit(key, max, windowMs)`, `RATE_LIMITS.{webhook, reviewAgain, mutation}`.
- `~/server/auth/auth` — Auth.js v5 `{ handlers, auth, signIn, signOut }` (JWT sessions; no adapter tables).
  `~/server/auth/session` — `getSessionUser()` (per-request cache), `requireUser()` (redirects).
  `~/server/auth/repo-access` — `accessibleRepoIds(userId)` (refreshes from GitHub when older than 1 h),
  `refreshRepoAccess(userId)`, `assertRepoAccess(userId, repoId)` (404, never 403).
  **Every dashboard query filters by `await access.repoIds()`.** Feedback and "Review again" check access too.
- `~/server/security/crypto` — `encryptSecret`, `decryptSecret` (AES-256-GCM).
- `~/server/queue/review-queue` — `reviewQueue()`, `enqueueReview(payload, manualNonce?)` (agent B owns it).
- "Review again" — `pullRequestsService.reviewAgain(id, repoIds, userId)` (`server/modules/pull-requests`):
  checks access (404), the block reasons (in progress / suspended / disabled / not open → 409, budget → 402),
  then `queueReview()` from `server/modules/github/review-start.service.ts` (agent B): marks the head commit's
  Review row queued (`trigger: 'manual'`), shows a fresh "Revo: reviewing…" check, enqueues with a nonce.
  Returns `{ reviewId, queuedAt }`. (The former `reviews/enqueue.ts` duplicate was removed in integration.)
- Layers: route handler (thin) → `server/modules/<feature>/<feature>.service.ts` (logic + Prisma) →
  `server/presenters/<model>.presenter.ts` (DTO) → `services/api/<feature>.ts` → `hooks/<feature>.ts`
  (React Query; keys in `lib/query-keys.ts` → `qk`) → components. No server actions for data
  (auth's sign-in form is the only server action). Zustand (`store/ui.store.ts`) for UI state only,
  nuqs for URL state (filters, tabs), react-hook-form + Zod for forms.
- `proxy.ts` is an optimistic cookie gate for pages (everything except `/sign-in`, `/dev/*`, `/api/*`).
  `(app)/layout.tsx` does the real check.

### GitHub pipeline (agent B)

Spec 3, 6, 7.1, 7.8, 7.9, 10, 13, 14. Code: `packages/github`, `apps/web/src/app/api/github/webhook`,
`apps/web/src/server/modules/github`, `apps/web/src/server/queue`, `apps/worker`, `tools/mock-github`.

- **`@revo/github`** (no DB code): `createGithubApp({ appId, privateKey, apiUrl })` → `installation(id)`
  (Octokit core + pagination, installation tokens via `@octokit/app`); `githubAppConfigFromEnv`,
  `GithubAppConfigSchema`; `repoRef(fullName)`; `githubErrorStatus(err)`. REST: `getPullRequest`,
  `listPullRequestFiles` (paginated), `getFileContent` (≤ 200 KB, text only, null when missing),
  `createCheckRun` / `updateCheckRun`, `upsertSummaryComment` (stored id → marker search → create),
  `findSummaryComment`, `listPostedFindingComments`, `createInlineReview` (one PR review, event COMMENT,
  `line`/`side: RIGHT`/`start_line`). Pure: `renderSummaryComment` / `renderCheckSummary` (spec 10,
  self-sufficient: headline with tone + "partial review", check passed/failed and why, partial-review
  warning, reviewed commit + previous score delta, counts table, score equation, problems table with
  line links at the head SHA, one `<details>` per problem (location, confidence, "lowered from",
  inline-thread link, explanation, ≤16-line excerpt from the stored snippet, fix), maxFindings note,
  dismissed count only (never listed), coverage with reviewed / not-reviewed file lists, scoring help
  with the repo's categories, footer model · trigger · time · tokens in/out · cost · links; drops detail
  in steps to stay under 60,000 chars), `partialCoverage()` (check title suffix), `inlineTarget(patch, start, end)` (lines of the
  diff only, multi-line inside one hunk, else first added line, else null = summary only),
  `renderInlineComment` (+ hidden `<!-- revo:finding <key> -->`), `findingKey` (file + title + category),
  check presentations `reviewingCheck` ("Revo: reviewing…"), `resultCheck` ("Score 72/100, needs a look",
  success/failure), `skippedCheck(reason)` (neutral, e.g. "Monthly budget reached"), `failedCheck`
  ("Revo couldn't review this PR"), `supersededCheck`, `closedCheck`; webhook `createWebhookVerifier`,
  payload Zod schemas, `isReviewAction`; rules `skipReasonFor` (disabled → draft → bot → budget),
  `REEVALUATED_SKIP_REASONS`. No raw-size hard skip (spec 7.3: lockfiles and generated files are filtered
  first, then `selectFiles` reviews the riskiest files; `too_large` only when not one file fits the token limit).
  Comments: `isAppComment(c, identity)` and `GithubApp.identity()` (`GET /app` → `<slug>[bot]`): Revo markers
  are trusted only in the App's own comments. `isGithubRateLimit(err)`: a 403 is retried only when it is a rate
  limit. `safeText` strips mentions, images, raw HTML and non-https links outside code spans; `codeSpan(path)`.
- **Webhook** `POST /api/github/webhook` (not `route()`: raw body): rate limit per IP → signature
  (`X-Hub-Signature-256`, 401 otherwise) → `WebhookDelivery` by `X-GitHub-Delivery` (repeat = no-op,
  a failed one may be redelivered) → events. `installation` created/deleted/suspend/unsuspend,
  `installation_repositories` added/removed (deleted = cascade delete, spec 14; repo changes mark every
  user's access snapshot stale). `pull_request`: every action upserts the PR row; `closed` sets
  merged/closed; opened/synchronize/reopened/ready_for_review → **one Review row per (PR, head SHA)**:
  skipped (draft/bot/disabled/budget, neutral check) or queued + "Revo: reviewing…" check + job.
  A row skipped for draft/bot/disabled/budget is re-evaluated by later events (ready_for_review).
- **Queue:** job id unique per enqueue (a commit can be queued again after its job finished), `deduplication { id: pr key, replace, keepLastIfActive }`
  - `delay = REVIEW_DEBOUNCE_SECONDS`: a push replaces the waiting job; a push during a running review
    runs after it. 3 attempts (1 + 2 retries), exponential backoff. Prefix `REVO_QUEUE_PREFIX` (default `revo`).
- **Worker** (`apps/worker`, `runReviewJob`): loads repo + settings → fetches the PR **live** and reviews
  its current head (queued rows of older commits are deleted, their checks closed as superseded; a
  closed PR drops its queued row) → skip rules again (manual re-runs ignore draft/bot) →
  "reviewing" check → files (+ full content of the selected files) → `reviewChanges` with
  `readFile` at the head SHA → inline comments for blockers/majors in the diff, not repeated across
  pushes (marker on GitHub) → summary comment linking those threads (edited in place, id on
  `PullRequest.summaryCommentId`; the fake engine shows as "Offline test engine (no AI)") →
  check success/failure → saves Review (status, score, label, passed, tokens, cost, duration, files,
  `skippedFiles` paths, notes) and Findings (confirmed with `posted`/`githubCommentId`, rejected with
  `rejectReason`). Tokens and cost **add up** across runs of one commit (budget). Failed attempt:
  row back to `queued` with `error`; last attempt (or a non-retryable error such as a refusal or
  GitHub 404/422): `failed` + neutral check. Links: `${APP_URL}/prs/<PullRequest.id>`.
- **Repo access refresh:** on demand with a 1 h TTL in `~/server/auth/repo-access` (foundation); the
  webhook nulls `User.accessCheckedAt` when an installation's repos change. No worker job for it.
- **Schema changes:** none by agent B.

### Dashboard (agent C)

- **Pages** (`app/(app)/`): `/` overview, `/prs` (filters in the URL: `q, repo, author, state, min, max,
blockers=yes, sort=lastReviewed|score|number, dir, page`), `/prs/[id]` (`?review=<id>` opens an older
  review; default latest), `/repos`, `/repos/[id]/settings` (`#budget` anchor), `/trends`
  (`?range=7d|30d|90d&repo=<id>`). Signed-out `/sign-in` is the mini landing.
- **API** (all `route()`, every query scoped by `access.repoIds()`; other repos answer 404):
  `GET /api/overview` → `OverviewDto`; `GET /api/repos` → `ReposDto`; `GET|PATCH /api/repos/[id]/settings`
  (`RepoSettingsBodySchema` = shared patch schema + glob validation; `enabled` goes to `Repo.enabled`) →
  `RepoSettingsPageDto` / `RepoSettingsDto`; `GET /api/prs` (`PullRequestListQuerySchema`) →
  `Paginated<PullRequestSummaryDto>`; `GET /api/prs/filters`; `GET /api/prs/[id]` → `PullRequestDetailDto`
  (reviews newest first, `budget`, `reviewAgain: { allowed, block, reason }`); `POST /api/prs/[id]/review-again`
  (rate limit `reviewAgain`, 202 `{ reviewId, queuedAt }`, 403 without write access on GitHub, 402
  `BUDGET_REACHED`, 409 when not open / disabled / suspended / already queued or running (unless stuck 30 min);
  `queueReview()` with `trigger: 'manual'`); settings `PATCH` needs maintain/admin (403), `GET` returns `canEdit`
  (the form turns view only); `GET /api/reviews/[id]` → `ReviewDetailDto` (confirmed `findings`, `rejected`, `breakdown`,
  `previousScore`, `threshold`); `PUT|DELETE /api/findings/[id]/feedback` (confirmed findings only, 422 otherwise)
  → `FindingFeedbackDto`; `GET /api/trends?range&repo` → `TrendsDto`.
- **Definitions:** "latest review" = newest `Review.createdAt` of the PR (any status); list score filters and
  blockers use it. Overview: PRs reviewed / average score over the last 7 days (rolling) vs the 7 before;
  precision = useful / (useful + wrong) over feedback rows of the last 30 days; cost = `sum(ReviewCost.costUsd)` by `spentAt`
  since the 1st of the UTC month vs the sum of enabled repos' budgets; a repo's budget is reached when
  spend ≥ `monthlyBudgetUsd` (so $0 stops at once). Trends: daily lines; category and precision buckets are
  daily for 7d and ISO weeks (Monday, `date_trunc('week')`) for 30d/90d; all aggregation is SQL (`$queryRaw`).
- **Code:** services in `server/modules/{overview,repos,pull-requests,reviews,findings,trends}`, presenters
  `server/presenters/{repo,review,finding,pull-request}.presenter.ts`, DTOs `types/*.ts`, schemas
  `schemas/{repo-settings,trends}.ts`, client `services/api/*` + `hooks/*`, components
  `components/{overview,prs,pr-detail,repos,trends,dashboard,command}`. `installUrlFor(slug)` in
  `server/modules/repos/install-url.ts`.
- **Tests:** `src/server/modules/dashboard.integration.test.ts` (revo_test, own rows, cleans up);
  `e2e/dashboard.spec.ts` (seeded revo_dev, undoes its feedback/settings changes; switches users with
  `POST /__mock/user`).
- **Schema changes:** none by agent C.

## Design system — "editorial precision"

Distinct from the user's earlier Raycast/Linear/Dub-like apps: **paper and ink**.
Look at `/dev/kit` (served in dev; in a prod build with `REVO_ENABLE_DEV_KIT=1`). It sets the bar.

- **Colours only through tokens** (`apps/web/src/app/globals.css`, light `:root` + `.dark`); no hex in components.
  - Surfaces: `background` (paper #faf9f6 / ink #121110), `card`, `popover`, `paper-sunken`, `muted`,
    `secondary`, `accent` (hover surface), `border`, `hairline`, `input`, `glass` (nav), `scrim` (overlays).
  - Text: `foreground`, `ink-soft`, `muted-foreground` (AA on every surface).
  - The one accent: `accent-brand` (ultramarine fill, white text), `accent-brand-ink` (accent as text),
    `accent-brand-soft`, `ring`. Use it for the primary action, focus, selection, the active data series.
  - Meaning only: tones `good|warn|bad` (+ `-ink` for text, `-soft` for backgrounds); severities
    `sev-blocker|sev-major|sev-minor` (+ `-ink`, `-soft`); code `code`, `code-highlight`, `code-gutter`;
    diff `diff-add(-ink)`, `diff-del(-ink)`; syntax `code-fg|comment|keyword|string|number|function|type|property|punctuation`
    (AA on `code` and `code-highlight`, used by the Shiki theme in `highlighter.ts`); charts `chart-1` (the accent
    series) and `series-1..6` (categorical: ink, plum, steel, sand, slate, stone; never accent or good/warn/bad),
    `chart-neutral`, `chart-grid`. Shadows: `shadow-card`, `shadow-float`, `shadow-elevated`.
- **Type:** `display` class / `font-display` = Instrument Serif for big numbers and page titles
  (sparingly, large); `font-sans` = Geist for UI; `font-mono` = Geist Mono for files, lines, SHAs,
  costs, metadata. `eyebrow` class = mono uppercase tracked label. `tabular` for aligned numbers.
- **Layout:** no sidebar. Floating pill top nav (`components/layout/top-nav.tsx`), content in
  `page-frame` (max-w-6xl, 16px gutters on phones), `PageHeader` (+ `MetaItem`) on every page,
  bento grids of `StatCard`s, generous whitespace, hairline borders, rounded-3xl cards.
- **Components** (`components/revo/`): `ScoreDial` (sm|md|lg|xl, `score: null` for no score),
  `ScoreBadge`, `ScoreDelta`, `SeverityChip`, `SeverityTally`, `CategoryChip`, `PrStateChip`,
  `ReviewStatusChip`, `CheckChip`, `StatCard` (+ `emphasis` ink tile), `Delta`, `Meter`
  (`kind="budget"` turns warn/bad), `Sparkline`, `CodeSnippet` (Shiki, both themes, line numbers,
  highlighted range), chart theme (`chartAxis`, `chartYAxis`, `chartGrid`, `chartLine`, `chartCursor`,
  `ChartTooltip`, `CHART_COLORS`, `SERIES_COLORS`, `CATEGORY_COLORS`), `tone.ts` class maps.
  `components/shared/`: `EmptyState`, `ErrorState`, `UserAvatar`, `DatePicker`.
  `components/layout/`: `AppShell`, `TopNav`, `CommandMenu` (⌘K; add groups via `extra`),
  `ThemeToggle`, `UserMenu`, `PageHeader`, `MetaItem`, `Providers`. `components/brand/`: `Wordmark`,
  `RevoMark`, `GithubMark` (sign-in button only).
- **shadcn/ui** primitives in `components/ui/` (radix-vega, restyled: pill buttons incl. `variant="accent"`,
  rounded-3xl cards). Change tokens, not primitives, for theming.
- **Icons:** `iconsax-react`, Bulk variant only (postinstall patch makes Bulk + currentColor the default;
  size with classes). Never lucide (ESLint blocks it).
- **Charts:** Recharts with the chart theme: thin 2px lines, dashed recessive horizontal grid, mono ticks,
  one axis, legend for ≥2 series, categories keep their colour (`CATEGORY_COLORS`), tooltips on hover.
- **Motion:** `motion/react`, short and tasteful; `MotionConfig reducedMotion="user"`; CSS respects
  `prefers-reduced-motion`.
- **Rules:** WCAG AA; labelled controls; visible focus; keyboard paths; never `<input type="date|time">`
  (use `DatePicker`); dialogs and sheets fit at 375 px with no sideways scroll (`DialogContent` already
  has `w-[calc(100%-2rem)] grid-cols-[minmax(0,1fr)]`); skeletons in content, spinners only in buttons;
  every list has an empty state and an error state with retry; calm microcopy, no exclamation marks.

## Testing recipes

- **Unit:** Vitest in every package (`pnpm test`). Pure logic is tested offline.
  `packages/db` integration tests use `TEST_DATABASE_URL` (run `pnpm db:test:prepare` first) and clean up
  their rows. `apps/web` unit tests stub `server-only` and get dummy env from `vitest.config.ts`.
- **Fake engine:** `REVO_ENGINE=fake` (default without a key). Same input → same findings, score and
  simulated tokens/cost. Patterns it reports: SQL interpolation, secrets, user id from body, query in a
  loop, swallowed errors, `<=` length loops, discount subtracted after tax, `Math.random` tokens,
  unchecked `JSON.parse`, local-time dates, missing tests for new exported functions; it rejects
  `parseInt` without radix and non-null `.find()!` (so "rejected by verification" has data).
- **Mock GitHub (4830):** OAuth authorize/token (incl. refresh), `/user`, `/user/emails`,
  `/user/installations`, `/user/installations/:id/repositories`, `/avatars/:login.svg`, `/health`.
  `POST /__mock/user` with `login=jonas-weber` makes the next sign-in that user (access to
  `northwind-labs/storefront` only); default `maya-chen` (all three repos).
  **GitHub App side** (`src/routes/app.ts`, state in `src/app-state.ts`, app id `MOCK_APP_ID = 1`, any RSA
  key): `POST /app/installations/:id/access_tokens`, `GET /repos/:o/:r/pulls/:n`, `…/pulls/:n/files`,
  `GET /repos/:o/:r/contents/:path?ref=`, `POST|PATCH …/check-runs`, `GET …/commits/:sha/check-runs`,
  `GET|POST …/issues/:n/comments`, `PATCH …/issues/comments/:id`, `GET …/pulls/:n/comments`,
  `POST …/pulls/:n/reviews` (422 when a line is not in the diff), `GET …/reviews/:id/comments`.
  The demo installation (northwind-labs, 3 repos) exists at start; mock PR numbers start at 1000.
  **Test hooks** (`src/routes/app-debug.ts`, each sends the signed webhook to `MOCK_WEBHOOK_URL` or
  `APP_URL/api/github/webhook`, secret `GITHUB_WEBHOOK_SECRET` from `.env`): `POST /__mock/webhook
{url, secret}`, `POST /__mock/installations {id, login, repos:[{id,name}]}`,
  `POST /__mock/installations/:id/{install|uninstall|suspend|unsuspend}`,
  `POST /__mock/installations/:id/repositories {add, remove}`, `POST /__mock/repos/:o/:r/pulls
{title, body?, author?, authorType?, draft?, files:[{path, after, before?}]}`,
  `POST …/pulls/:n/commits {files}` (synchronize), `…/close {merge}`, `…/reopen`, `…/ready`,
  `GET …/pulls/:n/activity` (checks, comments, reviews), `GET /__mock/deliveries`.
  In-process: `createMockGithubServer()` returns `{ server, state, app }`; `app.openPull()`,
  `app.pushCommit()`, `app.pullRequestEvent()`, `app.webhookRequest()` build the same data.
  **User side follows the App state:** `/user/installations` and `…/repositories` list the App installations a
  user can see (demo installation: `DEMO_ACCESS`; others: `members`, default `maya-chen`; pass
  `members: [login]` to `POST /__mock/installations`). Webhook delivery ids are random GUIDs (Revo stores
  them, so they must stay unique across mock restarts).
  **Failing Claude API** (`src/routes/anthropic.ts`): `POST /anthropic/v1/messages` always errors
  (`POST /__mock/anthropic {status}`: 401 default, 429, 500, 529). Worker with `REVO_ENGINE=claude
ANTHROPIC_BASE_URL=http://localhost:4830/anthropic` → "Revo couldn't review this PR".
  **App manifest flow** (`src/routes/manifest.ts`): `POST /settings/apps/new` and
  `/organizations/:org/settings/apps/new` (redirect with code + state), `POST /app-manifests/:code/conversions`
  (one use). `GITHUB_WEB_URL=http://localhost:4830 GITHUB_API_URL=http://localhost:4830 pnpm github:app --url …`.
- **Pipeline end to end locally:** `.env` has `GITHUB_APP_ID=1` and a dev key. Start the mock, the web
  app and `pnpm --filter @revo/worker dev` with `REVIEW_DEBOUNCE_SECONDS=3`, then
  `POST /__mock/installations` and `POST /__mock/repos/<owner>/<repo>/pulls`: the check, the summary
  comment and the inline comments appear in `GET …/activity`. Integration tests: `apps/web`
  `src/server/modules/github/webhook.test.ts` (revo_test + Redis db 7 with a random prefix + in-process
  mock), `apps/worker/test/{review-job,queue}.test.ts` (same; run serially).
- **Sign in during tests:** start the mock, run web with `GITHUB_OAUTH_BASE_URL`/`GITHUB_API_URL` at
  4830 (already in `.env`; a production build also needs `REVO_TEST_MODE=1`), click
  "Sign in with GitHub". Seeded users have no token; the mock sign-in stores an encrypted one and
  refreshes `RepoAccess`.
- **E2E:** `apps/web/playwright.config.ts` (Chrome channel, headless, port 3831, starts the mock and
  `next start` with `REVIEW_DEBOUNCE_SECONDS=2`, `APP_URL=http://localhost:3831` and webhooks to 3831 when
  they are not running; a server you started yourself must use the same settings). Specs: `auth`,
  `dashboard` (seeded revo_dev; counts 42 PRs), `design-kit`, `pipeline` (the whole product: own
  installation with a random id, spawns its own worker through `e2e/support/services.ts` `startWorker()`,
  swaps to a failing Claude API, uninstalls at the end, even on failure), `claude` (skipped unless
  `REVO_E2E_CLAUDE=1` + a key). Helpers: `e2e/support/{services,pull-request}.ts`. One command:
  `pnpm test:e2e`. Never use the Playwright MCP browser tools.
- **Repo access refresh:** `src/server/auth/repo-access.test.ts` (revo_test + in-process mock): fresh
  snapshot kept for an hour, refreshed after, refresh token used when the 8-hour token expired, roles
  stored, **fails closed** when GitHub rejects the token (rows and tokens deleted, 401; pages redirect to
  `/sign-in?reauth=1`), last snapshot kept ≤ 24 h only while GitHub is unreachable (then 503), one refresh
  shared by concurrent requests.
- **Screenshots:** Node scripts with `@playwright/test`'s `chromium` (channel `chrome`), at 1280×860,
  768×1024, 375×740, light and dark (`colorScheme`), checking console errors and
  `scrollWidth > innerWidth`. Save under your scratch folder and look at them.

## Integration and deployment (integration agent, 2026-11-21)

- **Docker:** `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `packages/db/Dockerfile` all start with
  `turbo prune <pkg> --docker` (pruned lockfile, `pnpm install --frozen-lockfile`), build, and run as a non-root
  user. Web: Next standalone (~63 MB app). Worker: tsup bundle (the `@revo/*` packages are inlined, so they are
  **devDependencies** of `@revo/worker`) + `pnpm deploy --prod --ignore-scripts --config.auto-install-peers=false`.
  Migrate: `prisma migrate deploy`. Each Dockerfile's steps were run by hand outside Docker; Docker itself is not
  installed here.
- **Compose:** Traefik (Let's Encrypt HTTP challenge, ping healthcheck, HSTS), Postgres 17, Redis 8 (AOF,
  noeviction), one-shot `migrate` that web and worker wait for, healthchecks and `restart: unless-stopped`
  everywhere, networks `revo_edge` (Traefik ↔ web) and `revo_backend`, log rotation, per-service secret scoping
  (web gets no Claude key; worker gets no sign-in secrets). Validated against the Compose JSON schema.
- **Worker heartbeat:** `apps/worker/src/heartbeat.ts` touches `$TMPDIR/revo-worker.heartbeat` every 15 s while
  BullMQ runs and Postgres answers; the container healthcheck reads its age. The worker warns when it runs
  the fake engine in production; an empty `REVO_ENGINE` means "unset".
- **GitHub App manifest:** `packages/github/src/manifest.ts` (`buildAppManifest`, `manifestFormAction`,
  `convertManifestCode`, `credentialsEnvBlock`; spec 6 permissions and events) and the CLI
  `packages/github/src/cli/create-app.ts` (`pnpm github:app`, local page on :3832, writes `.env.github-app`).
- **Docs:** `README.md` (screenshots in `docs/screenshots/`), `DEPLOY.md` (EC2 step by step).

## Shared changes log

Append one line per change to shared files: `date · agent · file · what · why`.

- 2026-11-21 · foundation · everything above · initial foundation.
- 2026-11-21 · C · `apps/web/src/components/layout/app-shell.tsx` · optional `commandExtra` prop passed to `CommandMenu extra` · ⌘K PR/repo search from `(app)/layout.tsx`.
- 2026-11-21 · C · `apps/web/src/lib/query-keys.ts` · added `qk.prs.filters()` · PR list filter options.
- 2026-11-21 · C · `apps/web/src/lib/{metrics,time-buckets,markdown}.ts` (new, tested) · `precisionRate`, `mean`, `roundTo`, `delta`, `trendDirection`, `scoreAxisFloor`; UTC day/week buckets matching Postgres `date_trunc` (`bucketStart`, `bucketKeys`, `windowStart`, `fillBuckets`, `formatBucket`); safe Markdown subset parser for finding suggestions (`parseMarkdown`, `parseInline`) · dashboard aggregation and rendering.
- 2026-11-21 · A · `.prettierignore` · added `eval/demo-repo` · eval patches are made against the demo repo's exact bytes; formatting it would break them.
- 2026-11-21 · A · `packages/review` contract · Claude engine, errors, `readFile` related files, `too_large` skip, exact `costUsd` (see "Claude engine and context" above) · additive; no shared package or schema changed.
- 2026-11-21 · B · `packages/shared/src/jobs.ts` · `reviewJobAddOptions` deduplication is now `{ id, replace: true, keepLastIfActive: true }` (was `ttl`/`extend`) · same meaning (debounce per PR), plus a push during a running review is kept and runs after it instead of being dropped.
- 2026-11-21 · B · `apps/web/src/server/config/env.ts` · added optional `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `REVO_QUEUE_PREFIX` · webhook creates check runs as the app; tests use a throwaway queue prefix.
- 2026-11-21 · B · `packages/db/src/budget.ts` (new) + export · `repoMonthSpendUsd(prisma, repoId, now?)` · budget checks in the webhook, "Review again" and the worker (dashboard may reuse it).
- 2026-11-21 · B · `apps/web/next.config.ts` · `@revo/github` in `transpilePackages` · webhook route imports it.
- 2026-11-21 · B · `apps/web/package.json` · dep `@revo/github`, devDep `@revo/mock-github`; `apps/worker` devDep `@revo/mock-github`; `tools/mock-github` devDep `@revo/shared` · webhook code and integration tests.
- 2026-11-21 · B · `tools/mock-github/src/{router,server,main}.ts` · router: `:param*` wildcard, URL-decoded params, handler errors → GitHub-style JSON; server registers the App + debug routes and returns `app`; main loads the root `.env` and sets the webhook target · GitHub App mock.
- 2026-11-21 · B · `.env.example` · `REVO_QUEUE_PREFIX`, `MOCK_WEBHOOK_URL`, mock app id/key note; local `.env` got `GITHUB_APP_ID=1` + a generated dev RSA key · local pipeline runs against the mock.
- 2026-11-21 · B · `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `docker-compose.yml` · copy the new workspace manifests; worker `stop_grace_period: 2m` · not run (no Docker here).
- 2026-11-21 · integration · `apps/web/src/server/modules/pull-requests/pull-requests.service.ts`, `types/pull-request.ts` · "Review again" calls `queueReview()` (row queued + immediate check) and returns `{ reviewId, queuedAt }`; removed the duplicate `server/modules/reviews/enqueue.ts` (its test now calls the service) · one implementation, the page shows "Queued" at once.
- 2026-11-21 · integration · `apps/web/src/server/auth/repo-access.ts` · concurrent stale-access refreshes for one user share one GitHub round trip (+ integration test) · a page load fires several API calls at once.
- 2026-11-21 · integration · `tools/mock-github` · user routes read the App state (new installations visible to `members`), random webhook delivery ids, failing Claude API stand-in, App manifest flow · end-to-end tests of install, failure and registration.
- 2026-11-21 · integration · `apps/worker` · `@revo/*` moved to devDependencies (bundled by tsup), heartbeat + healthcheck, empty `REVO_ENGINE` = unset, warning for fake engine in production · small production image, container health.
- 2026-11-21 · integration · `packages/github` · `manifest.ts` + `cli/create-app.ts` + `app:create` script (devDep `tsx`) · GitHub App registration from a manifest.
- 2026-11-21 · integration · root · `package.json` scripts `setup:local`, `test:e2e`, `test:claude`, `github:app`; `scripts/setup-local-env.mjs`; `.env.example` rewritten (documented, production-safe `REVO_ENGINE`); `docker-compose.yml` and the three Dockerfiles rewritten; `README.md`, `DEPLOY.md`, `docs/screenshots/` · deployment and docs (spec scope 7).
- 2026-11-21 · integration · `apps/web/playwright.config.ts`, `apps/web/e2e/{pipeline,claude}.spec.ts`, `e2e/support/*` · product-flow e2e and the opt-in real-Claude run.
- 2026-11-21 · fix (review findings) · `packages/shared` · `glob.ts` (linear glob engine + `globError`), `REPO_PERMISSIONS`/`repoPermissionFrom`/`canEditRepoSettings`/`canRequestReview`, `REVIEW_STALE_AFTER_MS`/`isStaleInFlight`, `reviewJobId(p, nonce)` now unique per enqueue + `reviewJobIdPrefix`, `API_ERROR_CODES` + `PAYLOAD_TOO_LARGE`, `ReviewDto.cacheWriteTokens` · ReDoS, permissions, lost jobs, body limit, token accounting.
- 2026-11-21 · fix · `packages/db` · migration `fix_access_costs`: `RepoPermission` enum + `RepoAccess.permission`, `Review.cacheWriteTokens`, `ReviewCost` ledger (backfilled), access snapshots marked stale; `repoMonthSpendUsd` sums the ledger by `spentAt`; `reviewCostEntry`, `pruneWebhookDeliveries` (30 days); seed: per-finding "Wrong" notes, ledger rows, realistic cache usage, demo roles (`DEMO_PERMISSION`: Maya admin, Jonas read) · budget by spend date, explainable tokens, coherent demo data.
- 2026-11-21 · fix · `apps/web/src/server/{auth,http}` · repo access fails closed (`revokeAccess`, 401, 503 after 24 h), `needsGithubSignIn`, `repoPermission`, `AccessScope.permission`; `http/body.ts` bounded body reads (webhook 25 MB, JSON 256 KB) used by `route()` and the webhook; `lib/safe-callback.ts` (sign-in return path by origin) · security review.
- 2026-11-21 · fix · `apps/web/src/components/{ui,revo,shared}`, `globals.css` · `Slider` `thumbLabel`/`thumbValueText`; `Sparkline` inert; `SeverityTally` sr-only text (`severityCountsText`); `StatCard` one-line eyebrow; Shiki theme from `--code-*` tokens (`tokenStyle`), `CodeSnippet` scroll region focusable; `series-1..6` replace `chart-2..6`; `thresholdLine()` · a11y and chart colour findings.
- 2026-11-21 · fix · root `turbo.json` · check/build tasks also depend on the package's own `db:generate` · `pnpm check` raced Prisma generation in parallel.
- 2026-11-21 · fix · `tools/mock-github` · `GET /app`, comment authors (+ `POST /__mock/repos/:o/:r/pulls/:n/comments`, 403 when the App edits someone else's comment), failure injection (`app.failNext`, `POST /__mock/fail {method,path,status,times}`), repo `permissions` per user · tests of forged markers, GitHub outages and roles.
- 2026-11-21 · user request · `packages/github` (`summary.ts`, `checks.ts` partial title, `inline.ts` `safeText` CommonMark-correct spans, fenced blocks, reference images/definitions, lone CR), `apps/worker` (`publish.ts` `SummaryContext`, `job.ts` inline comments before the summary) · richer, self-sufficient PR comment.
- 2026-11-22 · user request · `packages/shared` (`REVIEW_LIMITS` 10k lines / 100 files / 400k tokens, `maxUsageFiles`, `maxUsageSearches`), `packages/review` (`usages.ts`, `ChangedFile.sinceLastReview`, `RelatedFile.reason`, `ReviewInput.searchUsages`, `SkippedFileReason` `token_budget`, prompt, scaled `max_tokens`), `packages/github` (`compareCommits`, `searchCodePaths`, `token_budget` wording), `apps/worker` (`lastReviewedSha`, `markRecent`, `codeSearcher`), `tools/mock-github` (compare, `/search/code`, `mergeCommits`) · large PRs reviewed in full, new pushes looked at first, renamed fields checked against their users.
