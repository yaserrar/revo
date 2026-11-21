import { describe, expect, it } from 'vitest';
import { parsePatch } from '@revo/shared';
import { unifiedPatch } from '../src/line-diff';

const lines = (n: number, edit: (i: number) => string = (i) => `line ${i}`) =>
  Array.from({ length: n }, (_, i) => edit(i + 1)).join('\n') + '\n';

describe('unifiedPatch', () => {
  it('writes an added file as one hunk', () => {
    const out = unifiedPatch(null, 'a\nb\n');
    expect(out).toEqual({ patch: '@@ -0,0 +1,2 @@\n+a\n+b', additions: 2, deletions: 0 });
  });

  it('writes a removed file', () => {
    expect(unifiedPatch('a\n', null)).toEqual({ patch: '@@ -1,1 +0,0 @@\n-a', additions: 0, deletions: 1 });
  });

  it('keeps 3 lines of context and splits distant changes into hunks', () => {
    const before = lines(30);
    const after = lines(30, (i) => (i === 5 ? 'changed 5' : i === 25 ? 'changed 25' : `line ${i}`));
    const out = unifiedPatch(before, after);
    const hunks = parsePatch(out.patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 2, oldLines: 7, newStart: 2, newLines: 7 });
    expect(hunks[1]).toMatchObject({ oldStart: 22, newStart: 22 });
    const added = hunks.flatMap((h) => h.lines.filter((l) => l.type === 'add'));
    expect(added).toEqual([
      { type: 'add', content: 'changed 5', newLine: 5 },
      { type: 'add', content: 'changed 25', newLine: 25 },
    ]);
    expect(out).toMatchObject({ additions: 2, deletions: 2 });
  });

  it('numbers inserted lines on the new side', () => {
    const out = unifiedPatch('a\nb\nc\n', 'a\nb\nnew\nc\n');
    expect(out.patch).toBe('@@ -1,3 +1,4 @@\n a\n b\n+new\n c');
  });

  it('returns an empty patch for identical content', () => {
    expect(unifiedPatch('a\n', 'a\n').patch).toBe('');
  });
});
