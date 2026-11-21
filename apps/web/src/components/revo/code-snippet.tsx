'use client';

import { Copy, TickCircle } from 'iconsax-react';
import { useEffect, useState } from 'react';
import type { ThemedToken } from 'shiki/core';
import { languageForPath } from '@revo/shared';
import { formatLines } from '~/lib/format';
import { cn } from '~/lib/utils';
import { tokenStyle, tokenize } from './highlighter';

/**
 * A finding's code: file path header, line numbers from `startLine`, the
 * flagged range marked with an accent rule and tint, Shiki colours for both
 * themes. Renders plain text first, then swaps in highlighted tokens.
 */
export function CodeSnippet({
  code,
  path,
  startLine = 1,
  highlight,
  lang,
  className,
}: {
  code: string;
  path: string;
  startLine?: number;
  /** Inclusive range of new-file line numbers to mark. */
  highlight?: { from: number; to: number };
  /** Shiki-compatible id; defaults to the one for `path`. */
  lang?: string;
  className?: string;
}) {
  const language = lang ?? languageForPath(path);
  const [tokens, setTokens] = useState<{ key: string; lines: ThemedToken[][] } | null>(null);
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, '').split('\n');
  const key = `${language}\u0000${code}`;

  useEffect(() => {
    let alive = true;
    tokenize(code, language)
      .then((result) => {
        if (alive && result) setTokens({ key: `${language}\u0000${code}`, lines: result });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code, language]);

  const highlighted = tokens?.key === key ? tokens.lines : null;
  const gutterWidth = String(startLine + lines.length - 1).length;

  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <figure className={cn('min-w-0 overflow-hidden rounded-2xl border border-border bg-code', className)}>
      <figcaption className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={path}>
          {path}
        </span>
        {highlight ? (
          <span className="eyebrow hidden shrink-0 sm:inline">
            {formatLines(highlight.from, highlight.to)}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void copy()}
          className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          aria-label={copied ? 'Copied' : 'Copy code'}
        >
          {copied ? <TickCircle className="size-4 text-good-ink" /> : <Copy className="size-4" />}
        </button>
      </figcaption>
      {/* Focusable so keyboard users can scroll long lines sideways. */}
      <div
        className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
        tabIndex={0}
        role="region"
        aria-label={`Code of ${path}`}
      >
        <pre className="min-w-max py-3 font-mono text-[12.5px] leading-[1.7]">
          <code>
            {lines.map((line, i) => {
              const n = startLine + i;
              const marked = highlight ? n >= highlight.from && n <= highlight.to : false;
              return (
                <span
                  key={i}
                  className={cn('relative flex pr-6', marked && 'bg-code-highlight')}
                  data-highlighted={marked || undefined}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'absolute inset-y-0 left-0 w-[3px]',
                      marked ? 'bg-accent-brand' : 'bg-transparent',
                    )}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      'tabular shrink-0 pr-4 pl-4 text-right text-code-gutter select-none',
                      marked && 'text-accent-brand-ink',
                    )}
                    style={{ width: `calc(${gutterWidth}ch + 2rem)` }}
                  >
                    {n}
                  </span>
                  <span className="whitespace-pre">
                    {highlighted?.[i]
                      ? highlighted[i].map((t, j) => (
                          <span key={j} style={tokenStyle(t)}>
                            {t.content}
                          </span>
                        ))
                      : line || ' '}
                  </span>
                </span>
              );
            })}
          </code>
        </pre>
      </div>
    </figure>
  );
}
