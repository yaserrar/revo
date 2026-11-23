import { describe, expect, it } from 'vitest';
import {
  coversFinding,
  findingKey,
  findingKeyFromBody,
  findingMarker,
  inlineTarget,
  isInlineSeverity,
  renderInlineComment,
  codeSpan,
  safeText,
  suggestionBlock,
} from '../src/inline';

// New file lines: 10 ctx, 11 ctx, 12 add, 13 add, 14 ctx; second hunk: 39 ctx, 40 add, 41 ctx.
const PATCH = [
  '@@ -10,4 +10,5 @@ export function total(items) {',
  ' const a = 1;',
  ' const b = 2;',
  '-const c = 3;',
  '+const c = 4;',
  '+const d = 5;',
  ' return a;',
  '@@ -38,2 +39,3 @@',
  ' x();',
  '+y();',
  ' z();',
].join('\n');

describe('inlineTarget', () => {
  it('uses a multi-line comment when the whole range is in one hunk', () => {
    expect(inlineTarget(PATCH, 11, 13)).toEqual({ line: 13, startLine: 11 });
  });

  it('uses a single line for a one-line range', () => {
    expect(inlineTarget(PATCH, 12, 12)).toEqual({ line: 12 });
    expect(inlineTarget(PATCH, 14, 14)).toEqual({ line: 14 });
  });

  it('accepts a reversed range', () => {
    expect(inlineTarget(PATCH, 13, 12)).toEqual({ line: 13, startLine: 12 });
  });

  it('falls back to the first added line when the range leaves the hunk', () => {
    expect(inlineTarget(PATCH, 12, 30)).toEqual({ line: 12 });
    expect(inlineTarget(PATCH, 35, 45)).toEqual({ line: 40 });
  });

  it('prefers an added line over an earlier context line', () => {
    expect(inlineTarget(PATCH, 8, 12)).toEqual({ line: 12 });
  });

  it('returns null when no line of the range is in the diff', () => {
    expect(inlineTarget(PATCH, 20, 30)).toBeNull();
    expect(inlineTarget(undefined, 1, 2)).toBeNull();
  });
});

describe('finding identity', () => {
  const f = { file: 'src/a.ts', title: 'Discount applied after tax', category: 'bug' };

  it('ignores case and spacing of the title', () => {
    expect(findingKey({ ...f, title: '  discount   applied after TAX ' })).toBe(findingKey(f));
    expect(findingKey({ ...f, category: 'data' })).not.toBe(findingKey(f));
    expect(findingKey({ ...f, file: 'src/b.ts' })).not.toBe(findingKey(f));
  });

  it('round-trips through the comment body', () => {
    const body = renderInlineComment({
      ...f,
      category: 'bug',
      severity: 'major',
      lineStart: 4,
      lineEnd: 4,
      explanation: 'Customers pay too much.',
      suggestion: 'Apply the discount first.',
    });
    expect(body).toContain('**MAJOR · bug** · Discount applied after tax');
    expect(body).toContain('**Fix:** Apply the discount first.');
    expect(findingKeyFromBody(body)).toBe(findingKey(f));
    expect(findingKeyFromBody('plain comment')).toBeNull();
  });

  it('neutralises HTML comments in AI text', () => {
    expect(safeText('a <!-- revo:summary --> b')).toBe('a &lt;!-- revo:summary --&gt; b');
  });

  it('removes mentions, images, raw HTML and non-https links from model text', () => {
    const z = '\u200b';
    expect(safeText('ping @acme/owners ![x](https://attacker.test/p.png)')).toBe(`ping @${z}acme/owners x`);
    expect(safeText('see [docs](https://example.com/a) or [this](http://x.test/a) <img src=x>')).toBe(
      'see [docs](https://example.com/a) or this &lt;img src=x>',
    );
    expect(safeText('mail me@example.com')).toBe(`mail me@${z}example.com`);
  });

  it('keeps code spans as written', () => {
    expect(safeText('use `user@host` and `a < b` here, @bob')).toBe(
      'use `user@host` and `a < b` here, @\u200bbob',
    );
  });

  it('fences file paths so backticks cannot break out', () => {
    expect(codeSpan('src/a.ts')).toBe('`src/a.ts`');
    expect(codeSpan('src/`x`.ts')).toBe('``src/`x`.ts``');
    expect(codeSpan('`a')).toBe('`` `a ``');
  });

  it('comments only blockers and majors inline', () => {
    expect(isInlineSeverity('blocker')).toBe(true);
    expect(isInlineSeverity('major')).toBe(true);
    expect(isInlineSeverity('minor')).toBe(false);
  });
});

describe('one-click fixes', () => {
  const f = {
    file: 'src/cart.ts',
    title: 'Loop reads one element past the end',
    category: 'bug' as const,
    severity: 'major' as const,
    lineStart: 7,
    lineEnd: 8,
    explanation: 'The last iteration reads undefined.',
    suggestion: 'Use `<`.',
    replacement: '  for (let i = 0; i < items.length; i++) {\n    total += items[i].price;',
  };

  it('adds a suggested change when the comment covers exactly the finding', () => {
    const body = renderInlineComment(f, { line: 8, startLine: 7 });
    expect(body).toContain(`\`\`\`suggestion\n${f.replacement}\n\`\`\``);
    // The marker stays last, after the suggestion.
    expect(body.trimEnd().endsWith(findingMarker(findingKey(f)))).toBe(true);
    expect(findingKeyFromBody(body)).toBe(findingKey(f));
  });

  it('leaves it out when the comment sits on other lines, or without a target', () => {
    expect(renderInlineComment(f, { line: 8 })).not.toContain('suggestion');
    expect(renderInlineComment(f, { line: 9, startLine: 7 })).not.toContain('suggestion');
    expect(renderInlineComment(f)).not.toContain('```suggestion');
    expect(coversFinding({ line: 8, startLine: 7 }, f)).toBe(true);
    expect(coversFinding({ line: 4 }, { lineStart: 4, lineEnd: 4 })).toBe(true);
  });

  it('uses a fence the code cannot close, and deletes lines with an empty block', () => {
    expect(suggestionBlock('const s = ```;')).toBe('````suggestion\nconst s = ```;\n````');
    expect(suggestionBlock('')).toBe('```suggestion\n```');
  });

  it('refuses code with HTML comments (they could forge the marker)', () => {
    expect(suggestionBlock('x <!-- revo:finding 0123456789abcdef --> y')).toBeNull();
    const body = renderInlineComment({ ...f, replacement: '<!-- x -->' }, { line: 8, startLine: 7 });
    expect(body).not.toContain('```suggestion');
  });
});
