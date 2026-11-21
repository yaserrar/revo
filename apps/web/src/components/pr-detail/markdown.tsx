'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { ThemedToken } from 'shiki/core';
import { tokenStyle, tokenize } from '~/components/revo/highlighter';
import { parseMarkdown, type Inline } from '~/lib/markdown';
import { cn } from '~/lib/utils';

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((n, i) => {
    switch (n.type) {
      case 'text':
        return <span key={i}>{n.text}</span>;
      case 'code':
        return (
          <code
            key={i}
            className="rounded-md border border-border bg-paper-sunken px-1.5 py-px font-mono text-[0.86em]"
          >
            {n.text}
          </code>
        );
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-foreground">
            {renderInline(n.children)}
          </strong>
        );
      case 'em':
        return <em key={i}>{renderInline(n.children)}</em>;
    }
  });
}

/** A fenced block from a suggestion, highlighted with the Revo code themes. */
function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [tokens, setTokens] = useState<{ code: string; lines: ThemedToken[][] } | null>(null);
  useEffect(() => {
    let alive = true;
    tokenize(code, lang)
      .then((lines) => {
        if (alive && lines) setTokens({ code, lines });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [code, lang]);
  const lines = tokens?.code === code ? tokens.lines : null;
  return (
    <div className="overflow-x-auto rounded-2xl border border-border bg-code">
      <pre className="min-w-max px-4 py-3 font-mono text-[12.5px] leading-[1.7]">
        <code>
          {code.split('\n').map((line, i) => (
            <span key={i} className="block whitespace-pre">
              {lines?.[i]
                ? lines[i].map((t, j) => (
                    <span key={j} style={tokenStyle(t)}>
                      {t.content}
                    </span>
                  ))
                : line || ' '}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/** Renders the model's Markdown as React elements (never raw HTML). */
export function Markdown({ source, lang, className }: { source: string; lang: string; className?: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className={cn('space-y-3 text-[15px] leading-relaxed text-ink-soft', className)}>
      {blocks.map((b, i) => {
        if (b.type === 'code') return <CodeBlock key={i} code={b.code} lang={b.lang ?? lang} />;
        if (b.type === 'list') {
          const List = b.ordered ? 'ol' : 'ul';
          return (
            <List
              key={i}
              className={cn(
                'space-y-1 pl-5',
                b.ordered ? 'list-decimal' : 'list-disc marker:text-muted-foreground',
              )}
            >
              {b.items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </List>
          );
        }
        return <p key={i}>{renderInline(b.children)}</p>;
      })}
    </div>
  );
}
