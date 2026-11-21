import { describe, expect, it } from 'vitest';
import { addedLines, changedLineCount, commentableLines, parsePatch, rangesOverlap } from '../src/diff';

const patch = [
  '@@ -10,6 +10,8 @@ export function total(items: Item[]) {',
  '   let sum = 0;',
  '   for (const item of items) {',
  '-    sum += item.price;',
  '+    const price = item.price * item.qty;',
  '+    sum += price;',
  '+    sum -= item.discount ?? 0;',
  '   }',
  '   return sum;',
  ' }',
  '@@ -40 +42 @@',
  '-export const VERSION = 1;',
  '+export const VERSION = 2;',
  '\\ No newline at end of file',
].join('\n');

describe('parsePatch', () => {
  it('parses hunks with their headers and line numbers', () => {
    const hunks = parsePatch(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatchObject({ oldStart: 10, oldLines: 6, newStart: 10, newLines: 8 });
    expect(hunks[0]!.section).toBe('export function total(items: Item[]) {');
    expect(hunks[1]).toMatchObject({ oldStart: 40, oldLines: 1, newStart: 42, newLines: 1 });
  });

  it('numbers added, deleted and context lines', () => {
    const [first] = parsePatch(patch);
    expect(first!.lines[2]).toEqual({ type: 'del', content: '    sum += item.price;', oldLine: 12 });
    expect(first!.lines[3]).toEqual({
      type: 'add',
      content: '    const price = item.price * item.qty;',
      newLine: 12,
    });
    expect(first!.lines.at(-1)).toEqual({ type: 'context', content: '}', oldLine: 15, newLine: 17 });
  });

  it('returns nothing for an empty or missing patch', () => {
    expect(parsePatch('')).toEqual([]);
    expect(parsePatch(undefined)).toEqual([]);
  });
});

describe('line sets', () => {
  it('lists added and commentable lines', () => {
    expect([...addedLines(patch)]).toEqual([12, 13, 14, 42]);
    expect(commentableLines(patch).has(10)).toBe(true);
    expect(commentableLines(patch).has(41)).toBe(false);
  });

  it('counts changed lines', () => {
    expect(changedLineCount(patch)).toBe(6);
  });

  it('detects overlapping ranges', () => {
    expect(rangesOverlap(1, 5, 5, 9)).toBe(true);
    expect(rangesOverlap(1, 4, 5, 9)).toBe(false);
  });
});
