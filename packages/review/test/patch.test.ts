import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  hunkWindows,
  isPatchApplied,
  lineCount,
  renderNumberedLines,
  renderNumberedPatch,
} from '../src/patch';

const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n') + '\n';
const patch = [
  '@@ -2,3 +2,4 @@ export function x',
  ' b',
  '-c',
  '+C',
  '+c2',
  ' d',
  '@@ -8,2 +9,2 @@',
  ' h',
  '-i',
  '+I',
].join('\n');
const after = ['a', 'b', 'C', 'c2', 'd', 'e', 'f', 'g', 'h', 'I', 'j'].join('\n') + '\n';

describe('applyPatch', () => {
  it('applies every hunk and keeps the trailing newline', () => {
    expect(applyPatch(before, patch)).toBe(after);
  });

  it('returns null when the old side does not match', () => {
    expect(applyPatch(before.replace('c', 'z'), patch)).toBeNull();
  });

  it('creates a new file from an empty original', () => {
    expect(applyPatch('', '@@ -0,0 +1,2 @@\n+one\n+two')).toBe('one\ntwo\n');
  });

  it('applies a hunk that only inserts lines', () => {
    expect(applyPatch('a\nb\n', '@@ -1,0 +2,1 @@\n+x')).toBe('a\nx\nb\n');
  });
});

describe('isPatchApplied', () => {
  it('recognises the new side at its new line numbers', () => {
    expect(isPatchApplied(after, patch)).toBe(true);
    expect(isPatchApplied(before, patch)).toBe(false);
  });
});

describe('rendering', () => {
  it('numbers kept lines with new-file numbers and leaves deletions unnumbered', () => {
    const text = renderNumberedPatch(patch);
    expect(text.split('\n').slice(0, 6)).toEqual([
      '@@ -2,3 +2,4 @@ export function x',
      '    2   b',
      '      - c',
      '    3 + C',
      '    4 + c2',
      '    5   d',
    ]);
  });

  it('numbers file lines within a range', () => {
    expect(renderNumberedLines(after, 9, 10)).toBe('    9   h\n   10   I');
    expect(lineCount(after)).toBe(11);
  });

  it('merges hunk windows that touch and clamps to the file', () => {
    expect(hunkWindows(patch, 11, 2)).toEqual([{ from: 1, to: 11 }]);
    expect(hunkWindows(patch, 11, 0)).toEqual([
      { from: 2, to: 5 },
      { from: 9, to: 10 },
    ]);
  });
});
