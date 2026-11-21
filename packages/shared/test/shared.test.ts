import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPO_SETTINGS,
  FindingSchema,
  isBotLogin,
  languageForPath,
  PullRequestListQuerySchema,
  RepoSettingsSchema,
  ReviewJobPayloadSchema,
  reviewDebounceKey,
  reviewJobId,
  reviewJobIdPrefix,
  isStaleInFlight,
  repoPermissionFrom,
  canEditRepoSettings,
  canRequestReview,
  scoreLabel,
  scoreTone,
} from '../src';

describe('score labels', () => {
  it.each([
    [100, 'good_to_merge'],
    [90, 'good_to_merge'],
    [89, 'needs_a_look'],
    [70, 'needs_a_look'],
    [69, 'changes_needed'],
    [0, 'changes_needed'],
  ] as const)('%i is %s', (score, label) => {
    expect(scoreLabel(score)).toBe(label);
  });

  it('maps labels to tones', () => {
    expect(scoreTone(95)).toBe('good');
    expect(scoreTone(72)).toBe('warn');
    expect(scoreTone(40)).toBe('bad');
  });
});

describe('job ids', () => {
  const p = { repoGithubId: 51000001, prNumber: 42, headSha: 'ABCDEF1234567', trigger: 'auto' as const };

  it('is unique per enqueue, starts with the repo prefix and never contains ":"', () => {
    expect(reviewJobId(p, 'n1')).toBe('review-51000001-42-abcdef1234567-auto-n1');
    expect(reviewJobId(p, 'n1')).not.toContain(':');
    expect(reviewJobId(p, 'n1').startsWith(reviewJobIdPrefix(51000001))).toBe(true);
    expect(reviewJobId(p, 'n2')).not.toBe(reviewJobId(p, 'n1'));
  });

  it('separates manual reviews', () => {
    expect(reviewJobId({ ...p, trigger: 'manual' }, 'n1')).toBe('review-51000001-42-abcdef1234567-manual-n1');
  });

  it('spots in-flight reviews that lost their job', () => {
    const now = new Date('2026-11-21T12:00:00Z');
    const ago = (min: number) => new Date(now.getTime() - min * 60_000);
    expect(isStaleInFlight({ status: 'queued', updatedAt: ago(31) }, now)).toBe(true);
    expect(isStaleInFlight({ status: 'running', updatedAt: ago(45) }, now)).toBe(true);
    expect(isStaleInFlight({ status: 'queued', updatedAt: ago(5) }, now)).toBe(false);
    expect(isStaleInFlight({ status: 'failed', updatedAt: ago(500) }, now)).toBe(false);
  });

  it('maps GitHub permissions to roles and gates actions', () => {
    expect(repoPermissionFrom({ admin: true, push: true, pull: true })).toBe('admin');
    expect(repoPermissionFrom({ maintain: true, push: true })).toBe('maintain');
    expect(repoPermissionFrom({ push: true, pull: true })).toBe('write');
    expect(repoPermissionFrom({ triage: true, pull: true })).toBe('triage');
    expect(repoPermissionFrom({ pull: true })).toBe('read');
    expect(repoPermissionFrom(undefined)).toBe('read');
    expect(canEditRepoSettings('maintain')).toBe(true);
    expect(canEditRepoSettings('write')).toBe(false);
    expect(canRequestReview('write')).toBe(true);
    expect(canRequestReview('triage')).toBe(false);
  });

  it('debounces per PR', () => {
    expect(reviewDebounceKey(51000001, 42)).toBe('pr-51000001-42');
  });

  it('validates payloads', () => {
    const ok = ReviewJobPayloadSchema.safeParse({
      installationGithubId: 1,
      repoGithubId: 2,
      repoFullName: 'a/b',
      prNumber: 3,
      headSha: 'abc1234',
      trigger: 'auto',
      enqueuedAt: new Date().toISOString(),
    });
    expect(ok.success).toBe(true);
    expect(ReviewJobPayloadSchema.safeParse({ ...ok.data, headSha: 'not a sha' }).success).toBe(false);
  });
});

describe('schemas', () => {
  it('accepts the default settings', () => {
    expect(RepoSettingsSchema.parse(DEFAULT_REPO_SETTINGS)).toEqual(DEFAULT_REPO_SETTINGS);
  });

  it('rejects instructions over 2,000 characters', () => {
    expect(
      RepoSettingsSchema.safeParse({ ...DEFAULT_REPO_SETTINGS, instructions: 'x'.repeat(2001) }).success,
    ).toBe(false);
  });

  it('rejects a finding whose range is reversed', () => {
    const finding = {
      category: 'bug',
      severity: 'major',
      file: 'src/a.ts',
      lineStart: 10,
      lineEnd: 4,
      title: 't',
      explanation: 'e',
      suggestion: 's',
      confidence: 0.8,
    };
    expect(FindingSchema.safeParse(finding).success).toBe(false);
    expect(FindingSchema.safeParse({ ...finding, lineEnd: 12 }).success).toBe(true);
  });

  it('coerces list query strings', () => {
    const q = PullRequestListQuerySchema.parse({ state: 'open,merged', hasBlockers: 'true', page: '2' });
    expect(q).toMatchObject({ state: ['open', 'merged'], hasBlockers: true, page: 2, pageSize: 25 });
  });
});

describe('helpers', () => {
  it('detects bots', () => {
    expect(isBotLogin('dependabot[bot]')).toBe(true);
    expect(isBotLogin('renovate')).toBe(true);
    expect(isBotLogin('maya-chen')).toBe(false);
  });

  it('maps paths to languages', () => {
    expect(languageForPath('src/app/page.tsx')).toBe('tsx');
    expect(languageForPath('prisma/schema.prisma')).toBe('prisma');
    expect(languageForPath('Dockerfile')).toBe('docker');
    expect(languageForPath('LICENSE')).toBe('text');
  });
});
