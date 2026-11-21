import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_SETTINGS } from '@revo/shared';
import { globError, RepoSettingsBodySchema, RepoSettingsFormSchema } from './repo-settings';

describe('globError', () => {
  it('accepts usual patterns', () => {
    for (const p of ['docs/**', '**/*.generated.ts', 'src/{a,b}/*.ts', 'fixtures/[0-9]*.json', 'README.md']) {
      expect(globError(p), p).toBeNull();
    }
  });
  it('explains what is wrong', () => {
    expect(globError('')).toMatch(/Enter/);
    expect(globError('/abs/**')).toMatch(/relative/);
    expect(globError('my docs/**')).toMatch(/spaces/);
    expect(globError('src\\**')).toMatch(/forward/);
    expect(globError('../secrets/**')).toMatch(/above/);
    expect(globError('src/{a,b/*.ts')).toMatch(/Unbalanced/);
    expect(globError('src/]a[')).toMatch(/Unbalanced/);
    expect(globError('src/***')).toMatch(/\*\*/);
    expect(globError('x'.repeat(201))).toMatch(/200/);
  });
});

describe('RepoSettingsFormSchema', () => {
  it('accepts the defaults', () => {
    expect(RepoSettingsFormSchema.safeParse(DEFAULT_REPO_SETTINGS).success).toBe(true);
  });
  it('flags the bad glob and duplicates by index', () => {
    const result = RepoSettingsFormSchema.safeParse({
      ...DEFAULT_REPO_SETTINGS,
      ignoreGlobs: ['docs/**', '/root', 'docs/**'],
    });
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['ignoreGlobs.1', 'ignoreGlobs.2']));
  });
  it('enforces the 2,000-character instructions and at least one category', () => {
    expect(
      RepoSettingsFormSchema.safeParse({ ...DEFAULT_REPO_SETTINGS, instructions: 'x'.repeat(2001) }).success,
    ).toBe(false);
    expect(RepoSettingsFormSchema.safeParse({ ...DEFAULT_REPO_SETTINGS, categories: [] }).success).toBe(
      false,
    );
  });
});

describe('RepoSettingsBodySchema', () => {
  it('accepts a partial update', () => {
    expect(RepoSettingsBodySchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(RepoSettingsBodySchema.parse({ monthlyBudgetUsd: 0 })).toEqual({ monthlyBudgetUsd: 0 });
  });
  it('rejects an empty body, unknown models and bad globs', () => {
    expect(RepoSettingsBodySchema.safeParse({}).success).toBe(false);
    expect(RepoSettingsBodySchema.safeParse({ model: 'gpt-5' }).success).toBe(false);
    expect(RepoSettingsBodySchema.safeParse({ ignoreGlobs: ['/etc/**'] }).success).toBe(false);
  });
});
