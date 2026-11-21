import { describe, expect, it } from 'vitest';
import {
  candidateFiles,
  collectRelatedFiles,
  joinPath,
  loadTsPaths,
  matchTsPaths,
  parseImportSpecifiers,
  parseJsonc,
  prismaSchemaCandidates,
  usesPrisma,
  type FileReader,
} from '../src/related';
import type { ChangedFile } from '../src/types';

const reader =
  (files: Record<string, string>, log: string[] = []): FileReader =>
  async (path) => {
    log.push(path);
    return files[path] ?? null;
  };

const changed = (path: string, newContent: string): ChangedFile => ({
  path,
  status: 'modified',
  patch: '@@ -1 +1 @@\n-x\n+y',
  additions: 1,
  deletions: 1,
  newContent,
});

describe('parseImportSpecifiers', () => {
  it('finds static, type, re-export, side-effect, dynamic and require imports in order', () => {
    const source = [
      "import { a, b as c } from './a';",
      "import type { T } from '@/types';",
      'import {',
      '  multi,',
      "} from '../multi';",
      "import './side-effect';",
      "export * from './barrel';",
      "const lazy = await import('./lazy');",
      "const cjs = require('./cjs');",
      "import { a } from './a';",
    ].join('\n');
    expect(parseImportSpecifiers(source)).toEqual([
      './a',
      '@/types',
      '../multi',
      './side-effect',
      './barrel',
      './lazy',
      './cjs',
    ]);
  });
});

describe('paths', () => {
  it('joins and normalises, refusing to climb above the root', () => {
    expect(joinPath('src/app/api', '../../lib/db')).toBe('src/lib/db');
    expect(joinPath('', './x')).toBe('x');
    expect(joinPath('src', '../../x')).toBeNull();
  });

  it('lists TypeScript resolution candidates, mapping .js imports to .ts', () => {
    expect(candidateFiles('src/lib/db').slice(0, 2)).toEqual(['src/lib/db.ts', 'src/lib/db.tsx']);
    expect(candidateFiles('src/lib/db')).toContain('src/lib/db/index.ts');
    expect(candidateFiles('src/lib/db.js').slice(0, 1)).toEqual(['src/lib/db.ts']);
    expect(candidateFiles('prisma/schema.prisma')).toEqual(['prisma/schema.prisma']);
  });
});

describe('tsconfig paths', () => {
  it('parses JSON with comments and trailing commas without touching strings', () => {
    expect(parseJsonc('{ // c\n "a": "http://x/*y*/", /* b */ "b": [1,], }')).toEqual({
      a: 'http://x/*y*/',
      b: [1],
    });
    expect(parseJsonc('{ nope')).toBeNull();
  });

  it('loads paths relative to baseUrl, following a relative extends', async () => {
    const files = {
      'apps/web/tsconfig.json': '{ "extends": "../../tsconfig.base" }',
      'tsconfig.base.json':
        '{ "compilerOptions": { "baseUrl": "apps/web", "paths": { "~/*": ["src/*"], "env": ["src/env.ts"] } } }',
    };
    const paths = await loadTsPaths(reader(files), 'apps/web/tsconfig.json');
    expect(matchTsPaths('~/lib/db', paths)).toEqual(['apps/web/src/lib/db']);
    expect(matchTsPaths('env', paths)).toEqual(['apps/web/src/env.ts']);
    expect(matchTsPaths('react', paths)).toEqual([]);
  });
});

describe('prisma detection', () => {
  it('detects Prisma usage and lists schema locations nearest first', () => {
    expect(usesPrisma("import { PrismaClient } from '@prisma/client';")).toBe(true);
    expect(usesPrisma('await db.order.findMany({ where })')).toBe(true);
    expect(usesPrisma('const orders = list.filter(Boolean)')).toBe(false);
    expect(prismaSchemaCandidates(['apps/api/src/x.ts'])).toEqual([
      'apps/api/src/prisma/schema.prisma',
      'apps/api/src/schema.prisma',
      'apps/api/prisma/schema.prisma',
      'apps/api/schema.prisma',
      'apps/prisma/schema.prisma',
      'apps/schema.prisma',
      'prisma/schema.prisma',
      'schema.prisma',
    ]);
  });
});

describe('collectRelatedFiles', () => {
  const repo = {
    'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
    'prisma/schema.prisma': 'model Order { id String @id }',
    'src/lib/db.ts': 'export const db = new PrismaClient();',
    'src/lib/money.ts': 'export const cents = (n: number) => n * 100;',
    'src/lib/auth/index.ts': 'export function requireUser() {}',
    'src/generated/client.ts': 'export {}',
  };

  it('puts the Prisma schema first, then imports ranked by importers, skipping changed and ignored files', async () => {
    const files = [
      changed(
        'src/app/api/orders/route.ts',
        [
          "import { db } from '@/lib/db';",
          "import { cents } from '../../../lib/money';",
          "import { requireUser } from '@/lib/auth';",
          "import { helper } from './helper';",
          "import { x } from '@/generated/client';",
          "import { z } from 'zod';",
          'await db.order.findMany();',
        ].join('\n'),
      ),
      changed('src/app/api/orders/helper.ts', "import { cents } from '@/lib/money';"),
    ];
    const related = await collectRelatedFiles({ files, readFile: reader(repo), ignoreGlobs: [] });
    expect(related.map((r) => r.path)).toEqual([
      'prisma/schema.prisma',
      'src/lib/money.ts',
      'src/lib/db.ts',
      'src/lib/auth/index.ts',
    ]);
  });

  it('stops at maxFiles and respects the read cap', async () => {
    const log: string[] = [];
    const files = [changed('src/a.ts', "import './b';\nimport './c';\nimport './d';")];
    const related = await collectRelatedFiles({
      files,
      readFile: reader({ 'src/b.ts': 'b', 'src/c.ts': 'c', 'src/d.ts': 'd' }, log),
      maxFiles: 2,
    });
    expect(related.map((r) => r.path)).toEqual(['src/b.ts', 'src/c.ts']);
    const capped = await collectRelatedFiles({ files, readFile: reader({ 'src/d.ts': 'd' }), maxReads: 3 });
    expect(capped).toEqual([]);
  });

  it('scans the patch when there is no new content and tolerates reader errors', async () => {
    const file: ChangedFile = {
      path: 'src/x.ts',
      status: 'modified',
      patch: "@@ -1 +1,2 @@\n import { a } from './a';\n+import { b } from './b';",
      additions: 1,
      deletions: 0,
    };
    const failing: FileReader = async (path) => {
      if (path === 'src/a.ts') throw new Error('network');
      return path === 'src/b.ts' ? 'b' : null;
    };
    const related = await collectRelatedFiles({ files: [file], readFile: failing });
    expect(related.map((r) => r.path)).toEqual(['src/b.ts']);
  });
});
