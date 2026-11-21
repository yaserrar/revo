'use client';

import type { CSSProperties } from 'react';
import type { HighlighterCore, ThemeRegistration, ThemedToken } from 'shiki/core';

/**
 * Lazily created Shiki highlighter (JavaScript regex engine, no WASM) with
 * the Revo code theme. Languages load on first use; unknown ones fall back
 * to plain text.
 */
const LANG_LOADERS = {
  typescript: () => import('shiki/dist/langs/typescript.mjs'),
  tsx: () => import('shiki/dist/langs/tsx.mjs'),
  javascript: () => import('shiki/dist/langs/javascript.mjs'),
  jsx: () => import('shiki/dist/langs/jsx.mjs'),
  json: () => import('shiki/dist/langs/json.mjs'),
  prisma: () => import('shiki/dist/langs/prisma.mjs'),
  sql: () => import('shiki/dist/langs/sql.mjs'),
  css: () => import('shiki/dist/langs/css.mjs'),
  yaml: () => import('shiki/dist/langs/yaml.mjs'),
  python: () => import('shiki/dist/langs/python.mjs'),
  go: () => import('shiki/dist/langs/go.mjs'),
  shellscript: () => import('shiki/dist/langs/shellscript.mjs'),
  markdown: () => import('shiki/dist/langs/markdown.mjs'),
  dockerfile: () => import('shiki/dist/langs/dockerfile.mjs'),
  html: () => import('shiki/dist/langs/html.mjs'),
} as const;

type ShikiLang = keyof typeof LANG_LOADERS;

/** Maps ids from languageForPath() (@revo/shared) to the grammars bundled here. */
const ALIASES: Record<string, ShikiLang> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  prisma: 'prisma',
  sql: 'sql',
  css: 'css',
  scss: 'css',
  yaml: 'yaml',
  python: 'python',
  go: 'go',
  bash: 'shellscript',
  md: 'markdown',
  mdx: 'markdown',
  docker: 'dockerfile',
  html: 'html',
  vue: 'html',
  svelte: 'html',
};

/**
 * One theme for light and dark: every colour is a token from globals.css
 * (`--code-*`), each checked for WCAG AA on the code background and on the
 * highlighted lines in both themes.
 */
const v = (name: string) => `var(--code-${name})`;
const REVO_CODE_THEME: ThemeRegistration = {
  name: 'revo',
  type: 'light',
  colors: { 'editor.foreground': v('fg'), 'editor.background': 'var(--code)' },
  tokenColors: [
    {
      scope: ['comment', 'punctuation.definition.comment', 'string.comment'],
      settings: { foreground: v('comment'), fontStyle: 'italic' },
    },
    {
      scope: [
        'keyword',
        'storage',
        'storage.type',
        'storage.modifier',
        'keyword.control',
        'variable.language',
        'markup.heading',
      ],
      settings: { foreground: v('keyword') },
    },
    {
      scope: ['punctuation', 'meta.brace', 'keyword.operator', 'meta.embedded punctuation.section'],
      settings: { foreground: v('punctuation') },
    },
    {
      scope: [
        'string',
        'punctuation.definition.string',
        'string.template',
        'string.regexp',
        'markup.inline.raw',
      ],
      settings: { foreground: v('string') },
    },
    {
      scope: [
        'constant.numeric',
        'constant.language',
        'constant.character',
        'constant.other',
        'support.constant',
      ],
      settings: { foreground: v('number') },
    },
    {
      scope: ['entity.name.function', 'support.function', 'meta.function-call entity.name.function'],
      settings: { foreground: v('function') },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.other.inherited-class',
        'support.type',
        'support.class',
        'entity.name.tag',
      ],
      settings: { foreground: v('type') },
    },
    {
      scope: [
        'variable.other.property',
        'support.variable.property',
        'meta.object-literal.key',
        'entity.other.attribute-name',
        'variable.parameter',
      ],
      settings: { foreground: v('property') },
    },
  ],
};

/** Inline style of one highlighted token (colour from the theme tokens, italics for comments). */
export function tokenStyle(token: ThemedToken): CSSProperties {
  return {
    color: token.color,
    ...(token.fontStyle !== undefined && token.fontStyle & 1 ? { fontStyle: 'italic' } : {}),
  };
}

let highlighter: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
    ]);
    return createHighlighterCore({
      themes: [REVO_CODE_THEME],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    });
  })();
  return highlighter;
}

/** Tokens per line, coloured with `var(--code-*)` tokens. Null when the language is unknown. */
export async function tokenize(code: string, lang: string): Promise<ThemedToken[][] | null> {
  const id = ALIASES[lang];
  if (!id) return null;
  const h = await getHighlighter();
  if (!h.getLoadedLanguages().includes(id)) await h.loadLanguage(LANG_LOADERS[id]());
  return h.codeToTokens(code, { lang: id, theme: 'revo' }).tokens;
}
