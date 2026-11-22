import { describe, expect, it } from 'vitest';
import { DEFAULT_REPO_SETTINGS } from '@revo/shared';
import { buildReviewContext } from '../src/context';
import { compareFilePriority, selectFiles } from '../src/files';
import { ZERO_USAGE } from '../src/pricing';
import { reviewChanges } from '../src/review';
import type { ChangedFile, EngineContext, ReviewEngine } from '../src/types';
import {
  collectNameUsages,
  declaredIn,
  isDistinctiveName,
  mentions,
  removedNames,
  usesName,
} from '../src/usages';

const patch = (removed: string[], added: string[]) =>
  [
    `@@ -1,${removed.length} +1,${added.length} @@`,
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
  ].join('\n');

/** The rename that broke dropwave's share page: an API response key, still read by the web client. */
const SERVICE_PATCH = patch(
  ['      burnAfterDownload: drop.burnAfterDownload,'],
  ['      burnOnce: drop.burnAfterDownload,'],
);

function changed(path: string, extra: Partial<ChangedFile> = {}): ChangedFile {
  return { path, status: 'modified', patch: patch(['old'], ['new']), additions: 1, deletions: 1, ...extra };
}

describe('removedNames', () => {
  it('finds a renamed object key, even when the old name is still read on the new line', () => {
    expect(removedNames(SERVICE_PATCH)).toEqual(['burnAfterDownload']);
  });

  it('finds removed exports and public methods, not private ones', () => {
    const p = patch(
      [
        'export function formatDropSize(bytes: number) {',
        'export const MAX_DROP_SIZE = 20;',
        '  async getDropInfo(dropId: string) {',
        '  private async consumeDrop(dropId: string) {',
      ],
      ['export function formatSize(bytes: number) {'],
    );
    expect(removedNames(p).sort()).toEqual(['MAX_DROP_SIZE', 'formatDropSize', 'getDropInfo']);
  });

  it('ignores names declared again, short or one-word names, comments and file headers', () => {
    const p = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,5 +1,3 @@',
      '-  where: { id },',
      '-  status: "ok",',
      '-  // legacyField: removed in v2',
      '-  expiresAt: drop.expiresAt,',
      '+  expiresAt: drop.expiresAt ?? null,',
      '+  where: { id },',
    ].join('\n');
    expect(removedNames(p)).toEqual([]);
    expect(removedNames(undefined)).toEqual([]);
  });

  it('finds a shorthand key replaced by a renamed key', () => {
    expect(removedNames(patch(['      unlockedUntil,'], ['      unlockExpiresAt: unlockedUntil,']))).toEqual([
      'unlockedUntil',
    ]);
  });

  it('names nothing when an object, a parameter or a Go assignment is only deleted', () => {
    // A deleted log call, where clause or fixture: no key takes their place.
    expect(
      removedNames(patch(['  logger.info({', '    requestId: req.id,', '    durationMs: ms,', '  });'], [])),
    ).toEqual([]);
    expect(removedNames(patch(['    deletedAt: null,'], ['    id: dropId,']))).toEqual([]);
    expect(removedNames(patch(['\tuserName := r.FormValue("u")'], ['\tname := r.FormValue("u")']))).toEqual(
      [],
    );
    // A key at another depth is not its replacement.
    expect(removedNames(patch(['      requiresAuth: true,'], ['  pathName: "/a",']))).toEqual([]);
  });

  it('keeps a method whose signature a formatter wrapped, and an export the new code still declares', () => {
    const wrapped = patch(
      ['  async findDropById(id: string): Promise<Drop | null> {'],
      [
        '  async findDropById(',
        '    id: string,',
        '    options: FindOptions = {},',
        '  ): Promise<Drop | null> {',
      ],
    );
    expect(removedNames(wrapped)).toEqual([]);
    const moved = patch(['export function formatPrice(cents: number) {'], []);
    expect(removedNames(moved)).toEqual(['formatPrice']);
    expect(removedNames(moved, declaredIn('export function formatPrice(cents: number) {}'))).toEqual([]);
  });

  it('matches a removed key only where it is used as a property', () => {
    expect(usesName('if (data.unlockedUntil) x()', 'unlockedUntil', 'key')).toBe(true);
    expect(usesName('type D = { unlockedUntil: string | null }', 'unlockedUntil', 'key')).toBe(true);
    expect(usesName('const { unlockedUntil } = data', 'unlockedUntil', 'key')).toBe(true);
    expect(usesName("res['unlockedUntil']", 'unlockedUntil', 'key')).toBe(true);
    expect(usesName('const unlockedUntil = compute();', 'unlockedUntil', 'key')).toBe(false);
    expect(usesName('return unlockedUntil(drop);', 'unlockedUntil', 'export')).toBe(true);
  });

  it('only keeps distinctive names', () => {
    expect(isDistinctiveName('burnAfterDownload')).toBe(true);
    expect(isDistinctiveName('DropSummary')).toBe(true);
    expect(isDistinctiveName('max_size')).toBe(true);
    expect(isDistinctiveName('status')).toBe(false);
    expect(isDistinctiveName('aB')).toBe(false);
  });

  it('matches whole identifiers only', () => {
    expect(mentions('drop.burnAfterDownload && x', 'burnAfterDownload')).toBe(true);
    expect(mentions('burnAfterDownloadAt', 'burnAfterDownload')).toBe(false);
    expect(mentions('$burnAfterDownload', 'burnAfterDownload')).toBe(false);
  });
});

describe('collectNameUsages', () => {
  const service = changed('apps/api/src/drops/drops.service.ts', {
    patch: SERVICE_PATCH,
    newContent: 'return { burnOnce: drop.burnAfterDownload };',
  });
  const types = changed('apps/web/types/drop.ts', {
    newContent: 'export type Drop = { burnAfterDownload: boolean };',
  });

  it('lists the changed and related files that still use a removed name', async () => {
    const r = await collectNameUsages({
      files: [service, types],
      related: [{ path: 'apps/web/lib/api.ts', content: 'if (drop.burnAfterDownload) warn();' }],
    });
    expect(r.usages).toEqual([
      {
        name: 'burnAfterDownload',
        kind: 'key',
        removedIn: 'apps/api/src/drops/drops.service.ts',
        usedIn: ['apps/web/types/drop.ts', 'apps/web/lib/api.ts'],
      },
    ]);
    expect(r.extra).toEqual([]);
  });

  it('also reads the diff of the commits since the last review', async () => {
    const file = changed('apps/api/src/drops/drops.service.ts', {
      status: 'added',
      patch: patch([], ['return { burnOnce: drop.burnAfterDownload };']),
      sinceLastReview: { patch: SERVICE_PATCH },
    });
    const r = await collectNameUsages({ files: [file, types], related: [] });
    expect(r.usages.map((u) => u.name)).toEqual(['burnAfterDownload']);
  });

  it('adds files outside the change found by search, re-checked at the head', async () => {
    const repo: Record<string, string> = {
      'apps/web/components/share-card.tsx': '{drop.burnAfterDownload && <Notice />}',
      'apps/web/components/stale.tsx': 'nothing here any more',
      'apps/web/types/drop.ts': 'changed in the PR, never added twice',
      'dist/bundle.js': 'drop.burnAfterDownload',
    };
    const searched: string[] = [];
    const r = await collectNameUsages({
      files: [service],
      changedPaths: new Set([service.path, 'apps/web/types/drop.ts']),
      related: [],
      readFile: async (path) => repo[path] ?? null,
      search: async (name) => {
        searched.push(name);
        return Object.keys(repo);
      },
    });
    expect(searched).toEqual(['burnAfterDownload']);
    expect(r.extra).toEqual([
      {
        path: 'apps/web/components/share-card.tsx',
        content: repo['apps/web/components/share-card.tsx'],
        reason:
          'still uses `burnAfterDownload`, which this change removes or renames in apps/api/src/drops/drops.service.ts',
      },
    ]);
    expect(r.usages[0]!.usedIn).toEqual(['apps/web/components/share-card.tsx']);
  });

  it('caps searches and files, and stops searching at the first error', async () => {
    const many = changed('src/api/a.ts', {
      patch: patch(
        ['  firstName: a,', '  lastName: b,', '  postCode: c,', '  cityName: d,'],
        ['  givenName: a,'],
      ),
    });
    let calls = 0;
    const failing = await collectNameUsages({
      files: [many],
      related: [],
      readFile: async () => 'x',
      search: async () => {
        calls++;
        throw new Error('rate limited');
      },
    });
    expect(calls).toBe(1);
    expect(failing).toEqual({ usages: [], extra: [] });

    const repo = Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [
        `src/ui/f${i}.ts`,
        'u.firstName u.lastName u.postCode u.cityName',
      ]),
    );
    let searches = 0;
    const capped = await collectNameUsages({
      files: [many],
      related: [],
      readFile: async (path) => repo[path] ?? null,
      search: async () => {
        searches++;
        return Object.keys(repo);
      },
      maxSearches: 2,
      maxFiles: 3,
    });
    expect(searches).toBe(1); // the first search already filled the 3 files
    expect(capped.extra.map((f) => f.path)).toEqual(['src/ui/f0.ts', 'src/ui/f1.ts', 'src/ui/f2.ts']);
    // Later names are checked against the files found for earlier ones.
    expect(capped.usages.map((u) => [u.name, u.usedIn.length])).toEqual([
      ['firstName', 3],
      ['lastName', 3],
      ['postCode', 3],
      ['cityName', 3],
    ]);
  });
});

describe('files changed since the last review', () => {
  const lines = (n: number) =>
    `@@ -1,0 +1,${n} @@\n` + Array.from({ length: n }, (_, i) => `+line ${i}`).join('\n');
  const file = (path: string, n: number, recent = false): ChangedFile => ({
    path,
    status: 'modified',
    additions: n,
    deletions: 0,
    patch: lines(n),
    ...(recent ? { sinceLastReview: { patch: lines(1) } } : {}),
  });

  it('come first, before riskier and larger files', () => {
    const sorted = [file('src/api/pay.ts', 900), file('src/lib/format.ts', 1, true)].sort(
      compareFilePriority,
    );
    expect(sorted.map((f) => f.path)).toEqual(['src/lib/format.ts', 'src/api/pay.ts']);
  });

  it('are kept on a PR above the size limits', () => {
    const r = selectFiles(
      [file('src/api/pay.ts', 900), file('src/api/auth.ts', 900), file('src/lib/format.ts', 1, true)],
      { maxChangedLines: 1_000, maxFiles: 40 },
    );
    expect(r.selected.map((f) => f.path)).toEqual(['src/lib/format.ts', 'src/api/pay.ts']);
  });

  it('are marked in the context with the diff of the new commits', () => {
    const recent: ChangedFile = {
      ...changed('src/lib/format.ts', { newContent: 'export const a = 1;\nexport const b = 2;' }),
      patch: patch(['old a', 'old b'], ['export const a = 1;', 'export const b = 2;']),
      sinceLastReview: { patch: '@@ -2,1 +2,1 @@\n-old b\n+export const b = 2;' },
    };
    const ctx = buildReviewContext({
      pr: { title: 't', body: '' },
      files: [changed('src/api/pay.ts', { newContent: 'pay' }), recent],
      related: [],
      budgetTokens: 100_000,
    });
    expect(ctx.files[0]!.path).toBe('src/lib/format.ts');
    expect(ctx.text).toContain(
      'path="src/lib/format.ts" status="modified" priority="normal" changed_since_last_review="true">',
    );
    expect(ctx.text).toContain(
      '<latest_push_diff>\n@@ -2,1 +2,1 @@\n      - old b\n    2 + export const b = 2;\n</latest_push_diff>',
    );
    // Not repeated when the new commits are the whole PR diff.
    const same = buildReviewContext({
      pr: { title: 't', body: '' },
      files: [{ ...recent, sinceLastReview: { patch: recent.patch! } }],
      related: [],
      budgetTokens: 100_000,
    });
    expect(same.text).not.toContain('<latest_push_diff>');
  });
});

describe('removed names in the context', () => {
  it('lists each name with its users still in the context, and the reason of related files', () => {
    const ctx = buildReviewContext({
      pr: { title: 't', body: '' },
      files: [changed('apps/api/drops.service.ts', { newContent: 'x' })],
      related: [
        {
          path: 'apps/web/card.tsx',
          content: 'drop.burnAfterDownload',
          reason: 'still uses `burnAfterDownload`',
        },
      ],
      budgetTokens: 100_000,
      usages: [
        {
          name: 'burnAfterDownload',
          kind: 'key',
          removedIn: 'apps/api/drops.service.ts',
          usedIn: ['apps/web/card.tsx', 'gone.ts'],
        },
      ],
    });
    expect(ctx.text).toContain('<file path="apps/web/card.tsx" reason="still uses `burnAfterDownload`">');
    expect(ctx.text).toContain(
      '<removed_names count="1">\n- `burnAfterDownload` (object or type key renamed in apps/api/drops.service.ts) is still used in: apps/web/card.tsx\n</removed_names>',
    );
    expect(ctx.usages).toHaveLength(1);
  });

  it('drops the list when its users were cut to fit the budget', () => {
    const ctx = buildReviewContext({
      pr: { title: 't', body: '' },
      files: [changed('apps/api/drops.service.ts', { newContent: 'x' })],
      related: [{ path: 'apps/web/card.tsx', content: 'y'.repeat(40_000) }],
      budgetTokens: 2_000,
      usages: [
        {
          name: 'burnAfterDownload',
          kind: 'key',
          removedIn: 'apps/api/drops.service.ts',
          usedIn: ['apps/web/card.tsx'],
        },
      ],
    });
    expect(ctx.related).toEqual([]);
    expect(ctx.text).not.toContain('<removed_names');
    expect(ctx.usages).toEqual([]);
  });
});

describe('reviewChanges with removed names and recent files', () => {
  it('reads users outside the PR first, and notes both in the outcome', async () => {
    const seen: EngineContext[] = [];
    const engine: ReviewEngine = {
      kind: 'claude',
      async find(ctx) {
        seen.push(ctx);
        return { findings: [], usage: ZERO_USAGE };
      },
      async verify() {
        return { verifications: [], usage: ZERO_USAGE };
      },
    };
    const repo: Record<string, string> = {
      'apps/web/card.tsx': '{drop.burnAfterDownload && <Notice />}',
      'apps/api/src/lib/format.ts': 'export const x = 1;',
    };
    const outcome = await reviewChanges({
      pr: { title: 'Rename', body: '' },
      files: [
        changed('apps/api/src/drops/drops.service.ts', {
          patch: SERVICE_PATCH,
          newContent: "import { x } from '../lib/format';\nreturn { burnOnce: drop.burnAfterDownload };",
          sinceLastReview: { patch: SERVICE_PATCH },
        }),
      ],
      related: [],
      settings: { ...DEFAULT_REPO_SETTINGS },
      engine,
      readFile: async (path) => repo[path] ?? null,
      searchUsages: async () => ['apps/web/card.tsx'],
    });
    expect(outcome.notes).toEqual([
      '1 file changed since the last review: reviewed first, with the diff of the new commits.',
      'Also read a file outside this PR that still uses a name the change removes or renames: apps/web/card.tsx.',
    ]);
    const ctx = seen[0]!;
    expect(ctx.related.map((r) => r.path)).toEqual(['apps/web/card.tsx', 'apps/api/src/lib/format.ts']);
    expect(ctx.context.text).toContain('is still used in: apps/web/card.tsx');
  });
});
