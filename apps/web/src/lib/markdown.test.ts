import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('splits paragraphs and joins soft line breaks', () => {
    expect(parseMarkdown('Apply the discount\nbefore tax.\n\nThen round.')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Apply the discount before tax.' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Then round.' }] },
    ]);
  });

  it('keeps fenced code verbatim with its language', () => {
    const md = 'Use this:\n```ts\nconst a = 1;\n  return a * 2;\n```\nDone.';
    expect(parseMarkdown(md)).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'Use this:' }] },
      { type: 'code', lang: 'ts', code: 'const a = 1;\n  return a * 2;' },
      { type: 'paragraph', children: [{ type: 'text', text: 'Done.' }] },
    ]);
  });

  it('treats an unclosed fence as code to the end', () => {
    expect(parseMarkdown('```\nx()')).toEqual([{ type: 'code', lang: null, code: 'x()' }]);
  });

  it('groups bullet and numbered lists', () => {
    const blocks = parseMarkdown('- one\n- two\n1. first\n2) second');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: 'list',
      ordered: false,
      items: [[{ text: 'one' }], [{ text: 'two' }]],
    });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: true });
  });

  it('never produces HTML: tags stay text', () => {
    expect(parseMarkdown('<img src=x onerror=alert(1)>')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '<img src=x onerror=alert(1)>' }] },
    ]);
  });
});

describe('parseInline', () => {
  it('parses code, bold and italic', () => {
    expect(parseInline('Use `session.user.id` **not** the *body*.')).toEqual([
      { type: 'text', text: 'Use ' },
      { type: 'code', text: 'session.user.id' },
      { type: 'text', text: ' ' },
      { type: 'strong', children: [{ type: 'text', text: 'not' }] },
      { type: 'text', text: ' the ' },
      { type: 'em', children: [{ type: 'text', text: 'body' }] },
      { type: 'text', text: '.' },
    ]);
  });

  it('leaves stray markers and multiplication alone', () => {
    expect(parseInline('a * b * c and `open')).toEqual([{ type: 'text', text: 'a * b * c and `open' }]);
  });
});
