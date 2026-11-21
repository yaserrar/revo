/**
 * Demo data for development and screenshots: the fictional "northwind-labs"
 * organisation with three repos and ~40 PRs over the last 30 days, with
 * reviews, scores, confirmed and rejected findings, feedback and costs.
 * Deterministic (seeded PRNG); dates are relative to now. Wipes Revo data first.
 *
 *   pnpm db:seed
 */
import { computeScore, callCostUsd } from '@revo/review';
import { DEFAULT_REPO_SETTINGS, type ModelId, type PrState, type Severity } from '@revo/shared';
import { createPrismaClient } from '../../src/client';
import type { Prisma } from '../../src/generated/prisma/client';
import {
  DEMO_ACCESS,
  DEMO_AUTHORS,
  DEMO_INSTALLATION,
  DEMO_PERMISSION,
  DEMO_REPOS,
  DEMO_USER,
  DEMO_USER_LIMITED,
} from './fixtures';
import {
  BRANCH_PREFIX,
  FINDINGS,
  PR_TITLES,
  REJECTED,
  USEFUL_NOTES,
  type FindingTemplate,
  type RejectedTemplate,
  type RepoKey,
} from './templates';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const prisma = createPrismaClient();

// ── deterministic randomness ───────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261121);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
const between = (min: number, max: number) => Math.round(min + rand() * (max - min));
const chance = (p: number) => rand() < p;
const sha = () => Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(rand() * 16)]).join('');

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const now = Date.now();

const REPO_SETTINGS: Record<RepoKey, Partial<typeof DEFAULT_REPO_SETTINGS>> = {
  storefront: { instructions: 'We use Zod for all input validation and Prisma for every query.' },
  api: { threshold: 75, ignoreGlobs: ['docs/**', 'scripts/fixtures/**'], monthlyBudgetUsd: 30 },
  mobile: { model: 'claude-haiku-5-5', monthlyBudgetUsd: 10, inlineComments: false },
};

function repoSettingsRow(key: RepoKey) {
  const { enabled: _enabled, ...settings } = { ...DEFAULT_REPO_SETTINGS, ...REPO_SETTINGS[key] };
  return settings;
}

type Profile = 'clean' | 'minor' | 'major' | 'blocker';
const PROFILE_WEIGHTS: [Profile, number][] = [
  ['clean', 0.2],
  ['minor', 0.25],
  ['major', 0.35],
  ['blocker', 0.2],
];
function pickProfile(): Profile {
  let r = rand();
  for (const [p, w] of PROFILE_WEIGHTS) {
    if ((r -= w) <= 0) return p;
  }
  return 'clean';
}

function findingsFor(repo: RepoKey, profile: Profile): FindingTemplate[] {
  const pool = FINDINGS.filter((f) => f.repo === repo);
  const by = (s: Severity) => pool.filter((f) => f.severity === s);
  const out = new Set<FindingTemplate>();
  const add = (list: FindingTemplate[], n: number) => {
    for (let i = 0; i < n && list.length > 0; i++) out.add(pick(list));
  };
  if (profile === 'blocker') add(by('blocker').length ? by('blocker') : by('major'), 1);
  if (profile === 'major' || (profile === 'blocker' && chance(0.5))) add(by('major'), between(1, 2));
  if (profile !== 'clean') add(by('minor'), between(profile === 'minor' ? 1 : 0, 2));
  return [...out];
}

function usageFor(model: ModelId, files: number, findings: number) {
  // Like the real API: pass 1 writes the review context to the cache (only the
  // short task block after it is plain input); pass 2 reads it back.
  const context = between(9_000, 16_000) + files * between(1_800, 3_200);
  const find = {
    inputTokens: 600,
    outputTokens: 400 + findings * between(260, 420),
    cacheReadTokens: 4_800,
    cacheWriteTokens: context,
  };
  const verify = {
    inputTokens: 300 + findings * 300,
    outputTokens: 200 + findings * between(120, 220),
    cacheReadTokens: 4_800 + context,
    cacheWriteTokens: 0,
  };
  return {
    inputTokens: find.inputTokens + verify.inputTokens,
    outputTokens: find.outputTokens + verify.outputTokens,
    cachedTokens: find.cacheReadTokens + verify.cacheReadTokens,
    cacheWriteTokens: find.cacheWriteTokens + verify.cacheWriteTokens,
    costUsd: callCostUsd(model, find) + callCostUsd(model, verify),
  };
}

function findingRow(t: FindingTemplate | RejectedTemplate, index: number, verified: boolean) {
  const lineStart = t.startLine + t.line;
  return {
    index,
    category: t.category,
    severity: t.severity,
    file: t.file,
    lineStart,
    lineEnd: lineStart + t.span - 1,
    title: t.title,
    explanation: t.explanation,
    suggestion: t.suggestion,
    snippet: t.snippet,
    snippetStartLine: t.startLine,
    confidence: t.confidence,
    verified,
    rejectReason: 'rejectReason' in t ? t.rejectReason : null,
  };
}

async function wipe() {
  await prisma.$transaction([
    prisma.installation.deleteMany(),
    prisma.user.deleteMany(),
    prisma.webhookDelivery.deleteMany(),
  ]);
}

async function main() {
  await wipe();

  const installation = await prisma.installation.create({
    data: {
      githubId: DEMO_INSTALLATION.githubId,
      accountLogin: DEMO_INSTALLATION.accountLogin,
      accountType: DEMO_INSTALLATION.accountType,
      createdAt: new Date(now - 45 * DAY),
    },
  });

  const repoIds = {} as Record<RepoKey, string>;
  for (const r of DEMO_REPOS) {
    const key = r.name as RepoKey;
    const repo = await prisma.repo.create({
      data: {
        githubId: r.githubId,
        fullName: r.fullName,
        private: r.private,
        installationId: installation.id,
        createdAt: new Date(now - 45 * DAY),
        settings: { create: repoSettingsRow(key) },
      },
    });
    repoIds[key] = repo.id;
  }

  const users = [];
  for (const u of [DEMO_USER, DEMO_USER_LIMITED]) {
    const allowed = new Set<number>(DEMO_ACCESS[u.githubId] ?? []);
    users.push(
      await prisma.user.create({
        data: {
          githubId: u.githubId,
          login: u.login,
          name: u.name,
          accessCheckedAt: new Date(),
          repoAccess: {
            create: DEMO_REPOS.filter((r) => allowed.has(r.githubId)).map((r) => ({
              repoId: repoIds[r.name as RepoKey],
              permission: DEMO_PERMISSION[u.githubId] ?? 'read',
            })),
          },
        },
      }),
    );
  }
  const [maya, jonas] = users as [(typeof users)[0], (typeof users)[0]];

  let prCount = 0;
  let reviewCount = 0;
  let findingCount = 0;
  let feedbackCount = 0;

  for (const key of Object.keys(PR_TITLES) as RepoKey[]) {
    const settings = { ...DEFAULT_REPO_SETTINGS, ...REPO_SETTINGS[key] };
    const titles = PR_TITLES[key];
    let number = key === 'api' ? 412 : key === 'mobile' ? 158 : 231;
    for (const [i, title] of titles.entries()) {
      number += between(1, 4);
      const ageDays = (i / titles.length) * 29 + rand() * 0.9;
      const openedAt = new Date(now - (29.5 - ageDays) * DAY);
      const isBot = title.startsWith('Bump ');
      const author = isBot ? 'dependabot[bot]' : pick(DEMO_AUTHORS);
      const isNewest = i === titles.length - 1;
      const isDraft = key === 'storefront' && i === titles.length - 3;
      const ageMs = now - openedAt.getTime();
      const state: PrState =
        ageMs < 3 * DAY || isDraft || isNewest
          ? 'open'
          : chance(0.85)
            ? 'merged'
            : chance(0.5)
              ? 'closed'
              : 'open';
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 32);
      const branch = isBot ? `dependabot/npm_and_yarn/${slug}` : `${pick(BRANCH_PREFIX[key])}/${slug}`;

      const pr = await prisma.pullRequest.create({
        data: {
          repoId: repoIds[key],
          githubId: 900_000_000 + prCount,
          number,
          title,
          body: isBot
            ? 'Bumps the dependency to the latest patch release.'
            : `${title}.\n\nCloses #${number - between(3, 9)}.`,
          author,
          baseRef: 'main',
          headRef: branch,
          headSha: '',
          draft: isDraft,
          state,
          url: `https://github.com/${DEMO_INSTALLATION.accountLogin}/${key}/pull/${number}`,
          openedAt,
          createdAt: openedAt,
          mergedAt: state === 'merged' ? new Date(openedAt.getTime() + between(4, 60) * HOUR) : null,
          closedAt: state !== 'open' ? new Date(openedAt.getTime() + between(4, 60) * HOUR) : null,
        },
      });
      prCount++;

      // Pushes: the first review finds the most, later pushes fix things.
      const pushes = isBot || isDraft ? 1 : between(1, 3);
      let findings = findingsFor(key, pickProfile());
      let at = openedAt.getTime() + between(2, 6) * 60_000;
      let lastSha = '';
      let lastReviewedAt: Date | null = null;

      for (let p = 0; p < pushes; p++) {
        const headSha = sha();
        lastSha = headSha;
        const createdAt = new Date(Math.min(at, now - 10 * 60_000));
        const filesReviewed = between(2, 14);
        const isLast = p === pushes - 1;

        // Special cases for a realistic dashboard.
        if (isBot || isDraft) {
          await prisma.review.create({
            data: {
              pullRequestId: pr.id,
              repoId: repoIds[key],
              headSha,
              status: 'skipped',
              skipReason: isBot ? 'bot' : 'draft',
              model: settings.model,
              createdAt,
              finishedAt: createdAt,
            },
          });
          reviewCount++;
          break;
        }
        if (isNewest && isLast && key === 'storefront') {
          await prisma.review.create({
            data: {
              pullRequestId: pr.id,
              repoId: repoIds[key],
              headSha,
              status: 'running',
              model: settings.model,
              createdAt,
              startedAt: createdAt,
            },
          });
          reviewCount++;
          break;
        }
        if (key === 'api' && i === 6 && isLast) {
          await prisma.review.create({
            data: {
              pullRequestId: pr.id,
              repoId: repoIds[key],
              headSha,
              status: 'failed',
              error: 'Claude API overloaded (529) after 3 attempts',
              model: settings.model,
              createdAt,
              startedAt: createdAt,
              finishedAt: new Date(createdAt.getTime() + 95_000),
            },
          });
          reviewCount++;
          lastReviewedAt = createdAt;
          break;
        }

        const score = computeScore(findings, settings.threshold);
        const usage = usageFor(settings.model, filesReviewed, findings.length);
        const large = key === 'api' && i === 4 && p === 0;
        const rejected = REJECTED.filter((r) => r.repo === key && chance(0.35)).slice(0, 2);
        const durationMs = between(18_000, 70_000);

        const review = await prisma.review.create({
          data: {
            pullRequestId: pr.id,
            repoId: repoIds[key],
            headSha,
            status: 'done',
            trigger: p > 0 && chance(0.15) ? 'manual' : 'auto',
            score: score.score,
            label: score.label,
            passed: score.passed,
            model: settings.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cachedTokens: usage.cachedTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            costUsd: usage.costUsd.toFixed(6),
            durationMs,
            filesReviewed: large ? 18 : filesReviewed,
            filesSkipped: large ? 34 : between(0, 3),
            skippedFiles: large ? ['pnpm-lock.yaml', 'docs/api.md', 'src/generated/client.ts'] : [],
            notes: large ? ['Large PR: reviewed 18 of 52 files.'] : [],
            createdAt,
            startedAt: createdAt,
            finishedAt: new Date(createdAt.getTime() + durationMs),
            findings: {
              create: [
                ...findings.map((f, idx) => ({
                  ...findingRow(f, idx, true),
                  posted: f.severity !== 'minor',
                  createdAt,
                })),
                ...rejected.map((r, idx) => ({ ...findingRow(r, idx, false), createdAt })),
              ] satisfies Prisma.FindingCreateWithoutReviewInput[],
            },
          },
          include: { findings: true },
        });
        await prisma.reviewCost.create({
          data: {
            repoId: repoIds[key],
            reviewId: review.id,
            costUsd: usage.costUsd.toFixed(6),
            spentAt: new Date(createdAt.getTime() + durationMs),
          },
        });
        reviewCount++;
        findingCount += review.findings.length;
        lastReviewedAt = createdAt;

        for (const f of review.findings.filter((x) => x.verified)) {
          const template = FINDINGS.find((t) => t.repo === key && t.title === f.title)!;
          const voters = key === 'storefront' && chance(0.3) ? [maya, jonas] : [maya];
          for (const voter of voters) {
            if (!chance(0.65)) continue;
            const wrong = chance(0.13);
            await prisma.feedback.create({
              data: {
                findingId: f.id,
                userId: voter.id,
                outcome: wrong ? 'wrong' : 'useful',
                note: wrong ? template.wrongNote : pick(USEFUL_NOTES),
                createdAt: new Date(createdAt.getTime() + between(10, 300) * 60_000),
              },
            });
            feedbackCount++;
          }
        }

        // Next push fixes most problems.
        findings = findings.filter(() => chance(0.4));
        at += between(2, 20) * HOUR;
      }

      await prisma.pullRequest.update({ where: { id: pr.id }, data: { headSha: lastSha, lastReviewedAt } });
    }
  }

  console.log(
    `Seeded ${DEMO_INSTALLATION.accountLogin}: ${DEMO_REPOS.length} repos, ${prCount} PRs, ${reviewCount} reviews, ` +
      `${findingCount} findings, ${feedbackCount} feedback, users ${DEMO_USER.login} and ${DEMO_USER_LIMITED.login}.`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
