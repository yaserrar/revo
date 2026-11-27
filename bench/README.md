# Revo bench

A repeatable benchmark of Revo on a real codebase: **dropwave** (NestJS 12 API + Next.js web app,
the owner's file-sharing project). It runs Revo's real review pipeline (`reviewChanges`, both
passes, related files, `git grep` for users of renamed names) on 16 changes with known answers
and measures:

- **catch rate** on planted bugs,
- **false alarms** on clean, real feature commits,
- **tokens, cost and time** per review.

Re-run it after every prompt or pipeline change and compare the result files.

`eval/` is the other harness: 15 small PRs on a demo repo written for it. The bench is the
real-world counterpart: real commits, real file sizes, bugs the owner planted to test Revo.

## Run it

```sh
alias pnpm="npx -y pnpm@10.34.9"
pnpm bench                                   # all cases, Claude subscription, Sonnet 5.5, effort high (~4 min)
pnpm bench --only 03,15                      # cases whose id starts with 03 or 15
pnpm bench --model claude-opus-5-5 --label opus
pnpm bench --label prompt-v2                 # name the run after the change you are testing
pnpm bench --engine fake                     # offline, free: checks the harness only (no AI)
```

Options: `--engine claude-subscription|fake|claude` (default `claude-subscription`), `--model`,
`--effort low|medium|high|xhigh|max`, `--only`, `--label`, `--source <path or URL of dropwave>`
(default `../dropwave` next to this repo, or `REVO_BENCH_SOURCE`), `--work-dir` (default
`bench/.work`, gitignored), `--allow-api-key` (required with `--engine claude`).

Cases run **one at a time** (each review starts a Claude Code process; the machine has 16 GB).
A full run took 3 min 48 s of review time (2026-11-27). Results are written after every case to
`bench/results/<stamp>-<engine>-<model>[-label].{json,md}`, so an interrupted run keeps what it
measured.

### Who pays

| Engine                          | Auth                                                                                                                                               | Cost per run                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `claude-subscription` (default) | Claude Code through the Agent SDK, signed in with the Claude Pro/Max account (`claude`, then `/login`). API keys are removed from its environment. | $0 (subscription)                |
| `fake`                          | none, offline pattern matching                                                                                                                     | $0                               |
| `claude`                        | Anthropic SDK with `ANTHROPIC_API_KEY` from `.env`: **billed**. Needs `--allow-api-key`.                                                           | ≤ $2.80 (Sonnet), ≈ 2× with Opus |

The subscription engine is Revo's own (`packages/review/src/engines/claude-subscription.ts`). The
bench adds a guard: it also drops every `ANTHROPIC_*` and Claude Code session variable from the
child's environment, and reads each Claude Code run's `apiKeySource` before the model is called.
Anything other than `none` (no API key: the claude.ai login) stops the bench. The run prints the
sources it saw (`credential apiKeySource none`).

## The cases

`bench/cases/<id>/` holds `case.json`, `change.diff` (the change Revo reviews) and, for one case,
`base.diff`. The runner clones dropwave once into the work folder (the source repo is only read),
then for each case checks out `base.sha`, applies `base.diff` if any and `change.diff`, and
reviews that working tree. The planted commits are no longer on any branch of dropwave, so their
diffs are stored here; only the base commits (all on `dev`) are needed from the repo.

| Case                                       | Kind      | Change                                                                                  | Expected                                                             |
| ------------------------------------------ | --------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 01-planted-any-types                       | planted   | 53e6cdc, `formatBytes(bytes: any): any`                                                 | minor: types removed (label to confirm)                              |
| 02-planted-burn-field-rename               | planted   | 28bc61f, `burnAfterDownload` → `burnOnce` in GET /drops/:id                             | major: the web app still reads `burnAfterDownload`                   |
| 03-planted-burn-race                       | planted   | 9faac53, atomic `updateMany` → `findUnique` + `update`                                  | major: a burn-after-download link can be downloaded twice            |
| 04-planted-unlock-rename-limiter           | planted   | 9287ef7                                                                                 | two majors: `unlockedUntil` renamed; limiter leaks a slot on failure |
| 05-synthetic-zip-slip                      | synthetic | `..` kept after a folder in `normalizeRelativePath`                                     | blocker: path traversal in zip entries                               |
| 06-synthetic-upload-guard                  | synthetic | `UploadTokenGuard` lets requests without a token through                                | blocker: anyone with the link can change a drop's files              |
| 07-synthetic-unlock-await                  | synthetic | `verifyPassword` no longer awaited                                                      | blocker: any password unlocks                                        |
| 08-synthetic-folder-off-by-one             | synthetic | `foldersOf` loop bound one short                                                        | major: file/folder conflicts no longer detected                      |
| 11-clean-revert-unlock-limiter             | clean     | 50ed913, revert of 9287ef7 (base: 892ddf8 + `base.diff`)                                | nothing (label to confirm)                                           |
| 12-clean-time-picker … 18-clean-share-page | clean     | 0b6200d, eb18118, 12e56c8, 144a36c, 5a62225, 788f950, 892ddf8 (each on its real parent) | nothing, or minor nits                                               |

The planted bugs are reviewed on 892ddf8 (the commit the owner planted them on) one commit at a
time, not on their real parents, so each case holds only its own bug(s). Their original commit
titles ("breaking change", "Testing Revo") gave the answer away, so the cases use neutral PR
titles; the originals are in `case.json` → `source.message`. Synthetic cases are labelled as such
in their `kind`.

Lines in `expected` are on the new side of the diff (what Revo reports). `confirm` marks a label
the owner should confirm; the report lists them under "Labels to confirm".

`bench/known-false-positives.json` lists findings known to be wrong. Today: "zip error response
keeps Content-Type: application/zip" in `drops.service.ts` (NestJS 12's `ExpressAdapter.reply()`
resets Content-Type to JSON for error bodies), posted on dropwave PR #5.

### Adding a case

1. In a clone of dropwave: `git checkout <base>`, make the change, `git diff > change.diff` (or
   `git show --format= <sha> > change.diff` for a real commit).
2. Write `case.json` (copy one; `id` = folder name; `kind`; neutral `title` and `body`; full
   40-character `base.sha`; `expected` with file, lines on the new side, severity, description).
3. `pnpm --filter @revo/bench test` checks every case loads and every expected file is in its diff.

## Latest results

Baseline, 2026-11-27, `claude-subscription`, Sonnet 5.5, effort high:
[results/2026-11-27T11-12-45-claude-subscription-claude-sonnet-5-5-baseline.md](./results/2026-11-27T11-12-45-claude-subscription-claude-sonnet-5-5-baseline.md)

| Catch rate     | False alarms (8 clean cases) | Minor nits | Known FP again | Tokens / review | Cost / review (API prices) | Time / review |
| -------------- | ---------------------------- | ---------- | -------------- | --------------- | -------------------------- | ------------- |
| 7/9 bugs (78%) | 0                            | 1          | 0              | 79k             | $0.17 (billed $0)          | 14 s (max 42) |

Missed: the `any` types (01, no finding; label to confirm) and the `burnOnce` rename (02): pass 1
found it, but pass 2 rejected it because the three outside users Revo loaded for the renamed
name were API files (DTO, uploads service, migration), not the web components that read the
response. The limiter bug (04) was caught but rated minor instead of major.

## Scoring

Kept simple on purpose (`src/score.ts`):

- A posted finding **hits** an expected bug when it is in the same file and its lines overlap
  the bug's lines ± 5 (or one of its `alsoAt` locations). Category and wording are not compared:
  the question is "did Revo point at the bug". Each bug is credited once; more findings on it are
  duplicates.
- **Catch rate** = bugs hit / expected bugs (9 bugs in 8 cases). A failed case's bugs count as
  missed. The report also counts bugs pass 1 found but pass 2 rejected.
- **False alarms** = blocker and major findings on clean cases, plus any known false positive.
  Minor findings on clean cases are **nits**, reported apart and accepted ("no findings or minor
  nits"). Per clean case = false alarms / clean cases.
- **Extra findings** on bug cases (not at a planted bug) are listed but not scored: read them,
  some may be real.
- **Cost**: the subscription bills nothing per review, so the report prices the same tokens with
  Revo's price table (`packages/review/src/pricing.ts`): what the review would cost on the API.
  Claude Code's own estimate is kept in the JSON (`claudeCodeEstimateUsd`) to cross-check.
- **Time**: wall-clock of `reviewChanges` (both passes), one case at a time.

## Caveats

- 16 cases, one run: one bug more or less moves the catch rate by 11 points. Model output varies
  between runs; compare several runs before trusting a small change.
- The planted and synthetic bugs were written knowing Revo; real bugs are rarely this clean.
- "Clean" means no known bug, not proven bug-free: a false alarm on a clean case may be a real
  bug nobody noticed. Read them before counting them against Revo.
- On the subscription each pass is a separate Claude Code run, so pass 2 does not read pass 1's
  prompt cache as the API engine does: the API-price cost here is an upper bound for the `claude`
  engine (pass 2 costs less there).
- The line heuristic can credit a finding about something else next to the bug, or miss a
  correct finding that points at a caller far away. The report shows every title to check.
