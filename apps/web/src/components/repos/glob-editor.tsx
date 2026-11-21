'use client';

import { Add, ArrowDown2, Trash } from 'iconsax-react';
import { useId, useState } from 'react';
import type { FieldError as RhfFieldError } from 'react-hook-form';
import { Button } from '~/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '~/components/ui/collapsible';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';
import { globError } from '~/schemas/repo-settings';

/**
 * The repo's ignore patterns: edit in place, remove, or add one with instant
 * validation. The built-in list is shown read-only underneath.
 */
export function GlobEditor({
  globs,
  errors,
  onChange,
  builtIn,
}: {
  globs: string[];
  errors: (RhfFieldError | undefined)[] | undefined;
  onChange: (globs: string[]) => void;
  builtIn: string[];
}) {
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);
  const [showBuiltIn, setShowBuiltIn] = useState(false);
  const id = useId();

  const add = () => {
    const value = draft.trim();
    const error = globError(value) ?? (globs.includes(value) ? 'Already in the list.' : null);
    if (error) {
      setDraftError(error);
      return;
    }
    onChange([...globs, value]);
    setDraft('');
    setDraftError(null);
  };

  return (
    <div className="space-y-4">
      {globs.length > 0 ? (
        <ul className="space-y-2" aria-label="Ignored file patterns">
          {globs.map((glob, i) => {
            const error = errors?.[i]?.message;
            return (
              <li key={i} className="space-y-1">
                <div className="flex gap-2">
                  <label htmlFor={`${id}-${i}`} className="sr-only">
                    Pattern {i + 1}
                  </label>
                  <Input
                    id={`${id}-${i}`}
                    value={glob}
                    onChange={(e) => onChange(globs.map((g, j) => (j === i ? e.target.value : g)))}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${id}-${i}-error` : undefined}
                    className="font-mono text-[13px]"
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove pattern ${i + 1}`}
                    onClick={() => onChange(globs.filter((__, j) => j !== i))}
                  >
                    <Trash className="size-4" />
                  </Button>
                </div>
                {error ? (
                  <p id={`${id}-${i}-error`} role="alert" className="pl-1 text-xs text-bad-ink">
                    {error}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No extra patterns. Only the built-in list is ignored.</p>
      )}

      <div className="space-y-1">
        <div className="flex gap-2">
          <label htmlFor={`${id}-new`} className="sr-only">
            New pattern
          </label>
          <Input
            id={`${id}-new`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setDraftError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
            placeholder="docs/** or **/*.generated.ts"
            aria-invalid={Boolean(draftError)}
            aria-describedby={draftError ? `${id}-new-error` : undefined}
            className="font-mono text-[13px]"
            spellCheck={false}
            autoComplete="off"
          />
          <Button type="button" variant="outline" onClick={add} disabled={!draft.trim()}>
            <Add className="size-4" />
            Add
          </Button>
        </div>
        {draftError ? (
          <p id={`${id}-new-error`} role="alert" className="pl-1 text-xs text-bad-ink">
            {draftError}
          </p>
        ) : null}
      </div>

      <Collapsible open={showBuiltIn} onOpenChange={setShowBuiltIn}>
        <CollapsibleTrigger className="eyebrow inline-flex items-center gap-1.5 rounded-md py-1 transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
          Always ignored ({builtIn.length})
          <ArrowDown2 className={cn('size-3 transition-transform', showBuiltIn && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="mt-3 flex min-w-0 flex-wrap gap-1.5">
            {builtIn.map((g) => (
              <li
                key={g}
                className="max-w-full rounded-xl border border-border bg-paper-sunken px-2.5 py-1 font-mono text-[0.6875rem] break-all text-muted-foreground"
              >
                {g}
              </li>
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
