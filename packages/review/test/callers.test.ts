import { describe, expect, it } from 'vitest';
import { callsOf, changedFunctions, collectCallers, importsModule, moduleName } from '../src/callers';
import type { ChangedFile } from '../src/types';

/** Ticket2PR's usage service (shortened): the PR changed the body of `csv`. */
const SERVICE = [
  "import 'server-only';", //                                      1
  "import { prisma } from '~/server/config/prisma';", //           2
  '', //                                                            3
  'export const workUsageService = {', //                           4
  '  async project(projectId: string) {', //                        5
  '    return prisma.run.findMany({ where: { projectId } });', //   6
  '  },', //                                                        7
  '', //                                                            8
  '  async csv(projectId: string, period: string) {', //            9
  "    const name = project?.name ?? 'Project';", //                10
  '    return { filename: `usage - ${name}.csv`, body: "" };', //   11
  '  },', //                                                        12
  '};', //                                                          13
].join('\n');

const CSV_PATCH = [
  '@@ -9,4 +9,4 @@ export const workUsageService = {',
  '   async csv(projectId: string, period: string) {',
  "-    const slug = slugify(project?.name ?? 'project');",
  "+    const name = project?.name ?? 'Project';",
  '-    return { filename: `usage-${slug}.csv`, body: "" };',
  '+    return { filename: `usage - ${name}.csv`, body: "" };',
  '   },',
].join('\n');

const ROUTE = [
  "import { workUsageService } from '~/server/modules/usage/work-usage.service';",
  'export const GET = async () => {',
  "  const { filename, body } = await workUsageService.csv('p1', 'month');",
  '  return new Response(body, { headers: { "Content-Disposition": `attachment; filename="${filename}"` } });',
  '};',
].join('\n');

const service = (over: Partial<ChangedFile> = {}): ChangedFile => ({
  path: 'src/server/modules/usage/work-usage.service.ts',
  status: 'modified',
  patch: CSV_PATCH,
  additions: 2,
  deletions: 2,
  newContent: SERVICE,
  ...over,
});

describe('changedFunctions', () => {
  it('names the methods whose bodies the diff touches', () => {
    expect(changedFunctions(service())).toEqual(['csv']);
  });

  it('covers plain, exported and arrow functions, and deletions', () => {
    const src = [
      'export async function loadUser(id: string) {', // 1
      '  return id;', //                                  2
      '}', //                                             3
      'const formatName = (n: string) => {', //           4
      '  return n.trim();', //                            5
      '};', //                                            6
    ].join('\n');
    const patch = [
      '@@ -2,1 +2,1 @@',
      '-  return null;',
      '+  return id;',
      '@@ -6,1 +5,0 @@',
      '-  log(n);',
    ].join('\n');
    expect(changedFunctions({ patch, newContent: src }).sort()).toEqual(['formatName', 'loadUser']);
  });

  it('ignores control statements and needs the new version', () => {
    const src = ['function check(a: number) {', '  if (a > 1) {', '    return a;', '  }', '}'].join('\n');
    const patch = ['@@ -3,1 +3,1 @@', '-    return 0;', '+    return a;'].join('\n');
    expect(changedFunctions({ patch, newContent: src })).toEqual(['check']);
    expect(changedFunctions({ patch })).toEqual([]);
  });
});

describe('module and call matching', () => {
  it('derives the module name searched for', () => {
    expect(moduleName('src/server/modules/usage/work-usage.service.ts')).toBe('work-usage.service');
    expect(moduleName('src/lib/index.ts')).toBeNull();
    expect(moduleName('src/a.ts')).toBeNull();
  });

  it('recognises imports of the module, with or without an extension', () => {
    expect(importsModule(ROUTE, 'work-usage.service')).toBe(true);
    expect(importsModule("import x from '../usage/work-usage.service.js'", 'work-usage.service')).toBe(true);
    expect(importsModule("const s = require('./work-usage.service')", 'work-usage.service')).toBe(true);
    expect(importsModule("import x from './work-usage.service-old'", 'work-usage.service')).toBe(false);
    expect(importsModule('// see work-usage.service for details', 'work-usage.service')).toBe(false);
  });

  it('finds calls of the changed functions only', () => {
    expect(callsOf(ROUTE, ['csv', 'project'])).toEqual(['csv']);
    expect(callsOf('const csvRows = 1; csvExport();', ['csv'])).toEqual([]);
  });
});

describe('collectCallers', () => {
  const repo: Record<string, string> = {
    'src/app/api/projects/[projectId]/usage/csv/route.ts': ROUTE,
    'src/app/api/projects/[projectId]/usage/route.ts':
      "import { workUsageService } from '~/server/modules/usage/work-usage.service';\nexport const GET = () => workUsageService.project('p');",
    'docs/usage.md': 'work-usage.service builds the CSV: workUsageService.csv()',
    'dist/bundle.js': ROUTE,
  };
  const read = async (path: string) => repo[path] ?? null;

  it('adds the files outside the change that call a changed function, with the reason', async () => {
    const searched: string[] = [];
    const out = await collectCallers({
      files: [service()],
      taken: new Set([service().path]),
      readFile: read,
      search: async (term) => {
        searched.push(term);
        return Object.keys(repo);
      },
    });
    expect(searched).toEqual(['work-usage.service']);
    expect(out).toEqual([
      {
        path: 'src/app/api/projects/[projectId]/usage/csv/route.ts',
        content: ROUTE,
        reason: 'calls `csv()`, which this change modifies in src/server/modules/usage/work-usage.service.ts',
      },
    ]);
  });

  it('never adds a changed or already related file, and stops at a failed search', async () => {
    const taken = new Set([service().path, 'src/app/api/projects/[projectId]/usage/csv/route.ts']);
    expect(
      await collectCallers({
        files: [service()],
        taken,
        readFile: read,
        search: async () => Object.keys(repo),
      }),
    ).toEqual([]);
    const failing = await collectCallers({
      files: [service()],
      taken: new Set(),
      readFile: read,
      search: async () => {
        throw new Error('rate limited');
      },
    });
    expect(failing).toEqual([]);
  });

  it('does nothing without a search, or for files without changed functions', async () => {
    expect(await collectCallers({ files: [service()], taken: new Set(), readFile: read })).toEqual([]);
    const typesOnly = service({
      newContent: 'export type A = { b: string };',
      patch: '@@ -1,1 +1,1 @@\n-x\n+export type A = { b: string };',
    });
    let calls = 0;
    await collectCallers({
      files: [typesOnly],
      taken: new Set(),
      readFile: read,
      search: async () => {
        calls++;
        return [];
      },
    });
    expect(calls).toBe(0);
  });
});
