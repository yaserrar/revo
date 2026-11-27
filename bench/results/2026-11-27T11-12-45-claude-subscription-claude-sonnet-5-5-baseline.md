# Revo bench · 2026-11-27 11:12 UTC

Engine `claude-subscription` · model `claude-sonnet-5-5` · effort `high` · label `baseline` · 16 cases from `../dropwave`

## Totals

| Metric | Value |
| --- | --- |
| Catch rate (planted + synthetic bugs) | **7/9 (78%)** · 6/8 cases fully caught |
| Found in pass 1, rejected by pass 2 | 1 |
| False alarms on clean cases (blocker/major + known false positives) | **0 on 8 (0.00 per clean case)** · 8/8 quiet |
| Minor nits on clean cases (accepted) | 1 (0.13 per clean case) |
| Known false positives seen again | 0 |
| Extra findings on bug cases (not scored) | 0 |
| Tokens per case (avg) | 79.2k: 34.6k in, 8.5k cache read, 34.5k cache write, 1.6k out |
| Cost per case at API prices (avg) | $0.1725 (total $2.7605) |
| Billed | $0.0000 (Claude subscription) |
| Time per case (avg / max) | 14.3 s / 41.6 s (total 228.1 s) |
| Failed cases | 0 |

## Per case

| Case | Kind | Result | Posted findings | Rejected in pass 2 | Tokens | API-price cost | Time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 01-planted-any-types | planted | missed (0/1) | - | - | 28.5k | $0.0593 | 6.1 s |
| 02-planted-burn-field-rename | planted | missed (0/1) | - | "Renamed response field breaks clients that read burnAfterDownload" @ apps/api/src/drops/drops.service.ts:144 | 148.7k | $0.3297 | 14.8 s |
| 03-planted-burn-race | planted | caught (1/1) | HIT: major "consume() is no longer atomic: two concurrent downloads can both succeed" @ apps/api/src/drops/drops.service.ts:464-473 | - | 58.9k | $0.1253 | 7.5 s |
| 04-planted-unlock-rename-limiter | planted | caught (2/2) | HIT: major "Renamed response field still read as `unlockedUntil` by the web client" @ apps/api/src/drops/drops.service.ts:155<br>HIT: minor "Limiter leaks a slot when a task rejects, stalling the queue" @ apps/web/lib/limit.ts:20-24 | - | 151.6k | $0.3395 | 16.5 s |
| 05-synthetic-zip-slip | synthetic | caught (1/1) | HIT: blocker "".." after a folder is kept, so "a/../../x" escapes the drop (zip slip)" @ apps/api/src/lib/drop-paths.ts:19-20 | - | 54.3k | $0.1188 | 15.6 s |
| 06-synthetic-upload-guard | synthetic | caught (1/1) | HIT: blocker "Guard bypass: requests with no upload token are always allowed" @ apps/api/src/drops/upload-token.guard.ts:25-27 | - | 20.3k | $0.0377 | 9.4 s |
| 07-synthetic-unlock-await | synthetic | caught (1/1) | HIT: blocker "Dropped `await` on verifyPassword lets any password unlock a link" @ apps/api/src/drops/drops.service.ts:182-183 | - | 107.7k | $0.1443 | 13.0 s |
| 08-synthetic-folder-off-by-one | synthetic | caught (1/1) | HIT: major "foldersOf loop starts at 1 and drops the last folder prefix" @ apps/api/src/lib/drop-paths.ts:64 | - | 27.7k | $0.0573 | 13.5 s |
| 11-clean-revert-unlock-limiter | clean | quiet | - | - | 53.6k | $0.1139 | 3.7 s |
| 12-clean-time-picker | clean | quiet | - | - | 33.4k | $0.0729 | 7.9 s |
| 13-clean-max-size | clean | quiet | - | - | 15.7k | $0.0299 | 2.0 s |
| 14-clean-drops-schema | clean | quiet | - | - | 17.8k | $0.0361 | 6.0 s |
| 15-clean-drops-api | clean | quiet | - | - | 109.9k | $0.2777 | 41.6 s |
| 16-clean-drops-tests | clean | quiet | - | - | 49.3k | $0.1106 | 9.4 s |
| 17-clean-multi-upload | clean | quiet | - | - | 118.0k | $0.2895 | 34.9 s |
| 18-clean-share-page | clean | nits only | nit: minor "Single file rejected by the check shows "File is being scanned" forever" @ apps/web/components/share/shared-file-card.tsx:51-65 | - | 272.0k | $0.6180 | 26.4 s |

## Expected bugs

| Case | Bug | Where | Result | What it is |
| --- | --- | --- | --- | --- |
| 01-planted-any-types | any-types (minor) | apps/api/src/lib/format.ts:4 | missed | formatBytes(bytes: any): any drops the number/string types: callers lose type checking and a non-number (a string size, undefined) now flows through silently and prints "NaN undefined". |
| 02-planted-burn-field-rename | burn-field-rename (major) | apps/api/src/drops/drops.service.ts:144 | missed (rejected in pass 2) | GET /drops/:id now returns burnOnce instead of burnAfterDownload, but the web app (types/drop.ts, shared-bundle-card.tsx, shared-file-card.tsx, unlock-card.tsx) still reads drop.burnAfterDownload: burn-after-download links look like normal links, previews and per-file downloads are offered and then refused. |
| 03-planted-burn-race | burn-race (major) | apps/api/src/drops/drops.service.ts:463-474 | caught | consume() now reads, checks, then writes (findUnique + update) instead of one UPDATE guarded by consumedAt IS NULL: two downloads at the same moment both pass the check, so a burn-after-download link can be downloaded twice. |
| 04-planted-unlock-rename-limiter | unlock-field-rename (major) | apps/api/src/drops/drops.service.ts:155 | caught | GET /drops/:id returns unlockExpiresAt instead of unlockedUntil, but the web app (shared-drop.tsx, types/drop.ts) still reads data.unlockedUntil: the timer that shows the password prompt again when the unlock ends never runs. |
| 04-planted-unlock-rename-limiter | limiter-slot-leak (major) | apps/web/lib/limit.ts:20-24 | caught | When a task rejects, active is never decremented and next() is not called (the .finally was dropped): each failed upload leaks a concurrency slot, and after `concurrency` failures every queued upload hangs forever. |
| 05-synthetic-zip-slip | path-traversal (blocker) | apps/api/src/lib/drop-paths.ts:19-20 | caught | A ".." after a folder is now kept, so "photos/../../evil.sh" passes normalizeRelativePath; it is stored as the file's path and written as a zip entry name, so extracting the "Download all" zip writes outside the target folder (zip slip). The existing spec expects photos/../../a.jpg to be rejected. |
| 06-synthetic-upload-guard | upload-auth-bypass (blocker) | apps/api/src/drops/upload-token.guard.ts:25-27 | caught | A request with no x-upload-token header now passes the guard: anyone who has a share link (the drop id) can add, replace or remove that drop's files. |
| 07-synthetic-unlock-await | unlock-missing-await (blocker) | apps/api/src/drops/drops.service.ts:182-183 | caught | verifyPassword returns a Promise; without await, passwordMatches is always truthy, so any password unlocks a protected drop. |
| 08-synthetic-folder-off-by-one | folders-off-by-one (major) | apps/api/src/lib/drop-paths.ts:62-68 | caught | The loop stops one folder early (i < segments - 1 instead of i < segments): the deepest folder of every path is missing ("notes/a.txt" gives no folder), so findPathConflict no longer catches a file named like a folder ("notes" and "notes/a.txt") and such zips cannot be extracted. |

## Labels to confirm

- **01-planted-any-types / any-types**: Type-safety regression with no runtime bug today. Should Revo be expected to report it (it is a minor at most)? If not, move this case to the clean set.
- **11-clean-revert-unlock-limiter** (case label): Listed with the planted bugs, but a revert of buggy code is a clean change: expected no findings. Confirm.

## How it is scored

A posted finding hits an expected bug when it is in the same file and its lines overlap the bug's lines ± 5 (category and wording are not compared). Each bug is credited once. On clean cases, a blocker or major finding is a false alarm and a minor one is an accepted nit; a finding matching `bench/known-false-positives.json` (file + keyword) is a false alarm wherever it appears. Extra findings on bug cases are listed but not scored: read them, some may be real. "API-price cost" prices the tokens with Revo's price table (`packages/review/src/pricing.ts`), i.e. what the review would cost through the API engine; on the subscription nothing is billed per review.
