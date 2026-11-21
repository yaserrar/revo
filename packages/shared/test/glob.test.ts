import { describe, expect, it } from 'vitest';
import { BUILT_IN_IGNORE_GLOBS, createGlobMatcher, expandBraces, globError } from '../src';

const matches = (glob: string, path: string) => createGlobMatcher([glob])(path);

describe('createGlobMatcher', () => {
  it.each([
    ['dist/**', 'dist', true],
    ['**/dist/**', 'dist', true],
    ['**/dist/**', 'a/dist/b.js', true],
    ['**/*.map', 'x.map', true],
    ['**/*.map', '.map', true],
    ['docs/', 'docs/a.md', false],
    ['*.md', 'a/b.md', false],
    ['*.md', 'README.md', true],
    ['src/a**b', 'src/axxb', true],
    ['src/a**b', 'src/ax/xb', false],
    ['{a}', 'a', false],
    ['{a}', '{a}', true],
    ['[!a]x', 'bx', true],
    ['[^a]x', 'ax', false],
    ['[a-c]', 'b', true],
    ['[a-c]', 'd', false],
    ['**', '.env', true],
    ['**/.env', 'x/.env', true],
    ['*', '.env', true],
    ['src/*/x', 'src/x', false],
    ['a/**/b', 'a/b', true],
    ['a/**/b', 'a/x/y/b', true],
    ['*.{ts,tsx}', 'a.tsx', true],
    ['{src,lib}/**/*.{ts,js}', 'lib/x/y.js', true],
    ['a/{b,c/d}/e', 'a/c/d/e', true],
    ['x?', 'x/', false],
    ['x?', 'xy', true],
    ['**/*', 'a/b', true],
    ['a/', 'a', false],
    ['./src/**', 'src/a.ts', true],
    ['src/**/*.test.ts', 'src/a/b.test.ts', true],
    ['src/**/*.test.ts', 'src/a/b.ts', false],
  ])('%s against %s is %s', (glob, path, expected) => {
    expect(matches(glob, path)).toBe(expected);
  });

  it('applies the built-in ignore list', () => {
    const ignored = createGlobMatcher(BUILT_IN_IGNORE_GLOBS);
    for (const path of [
      'pnpm-lock.yaml',
      'apps/web/package-lock.json',
      'dist/index.js',
      'packages/x/node_modules/y/index.js',
      'public/logo.png',
      'assets/app.min.js',
      'src/__snapshots__/a.snap',
      'vendor/tool.tar',
    ]) {
      expect(ignored(path), path).toBe(true);
    }
    for (const path of ['src/app.ts', 'README.md', 'distribution/a.ts', 'src/pnpm-lock.ts']) {
      expect(ignored(path), path).toBe(false);
    }
  });

  it('stays fast on patterns that make backtracking matchers explode', () => {
    const name = 'src/' + '-'.repeat(4000) + '.tsx';
    const deep = Array.from({ length: 400 }, () => 'a').join('/');
    const patterns = [
      '**/*' + '?*'.repeat(30) + 'Q',
      '**/*-*-*-*-*-*-*-*-*-*Q',
      '**/a/**/a/**/a/**/a/**/a/**/a/**/Q',
      '**/{*-*-*-*Q,*a*a*a*R}',
    ];
    const started = performance.now();
    const match = createGlobMatcher(patterns);
    expect(match(name)).toBe(false);
    expect(match(deep)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('matches nothing for a glob with too many brace combinations', () => {
    const glob = '{a,b}'.repeat(6);
    expect(matches(glob, 'aaaaaa')).toBe(false);
  });
});

describe('expandBraces', () => {
  it('expands nested groups and keeps literal ones', () => {
    expect(expandBraces('a.{ts,{js,mjs}}')).toEqual(['a.ts', 'a.js', 'a.mjs']);
    expect(expandBraces('{a}.{b,c}')).toEqual(['{a}.b', '{a}.c']);
  });

  it('stops above the limit', () => {
    expect(expandBraces('{a,b}'.repeat(5))).toHaveLength(32);
    expect(expandBraces('{a,b}'.repeat(6))).toBeNull();
  });
});

describe('globError', () => {
  it('accepts ordinary patterns', () => {
    for (const p of ['docs/**', '**/*.generated.ts', 'src/{a,b}/*.ts', 'fixtures/[a-z]*.json']) {
      expect(globError(p), p).toBeNull();
    }
  });

  it('rejects patterns that expand too far', () => {
    expect(globError('{a,b}'.repeat(6))).toMatch(/combinations/);
  });
});
