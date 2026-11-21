'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';
import { Controller, useForm, useWatch, type Resolver } from 'react-hook-form';
import { toast } from 'sonner';
import {
  CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  CATEGORY_LABELS,
  SCORE_LABEL_TEXT,
  scoreLabel,
  RepoSettingsSchema,
  type RepoSettingsDto,
} from '@revo/shared';
import { BudgetBanner } from '~/components/dashboard/budget-banner';
import { Meter } from '~/components/revo/stat-card';
import { TONE_CLASSES, scoreTone } from '~/components/revo/tone';
import { Button } from '~/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '~/components/ui/input-group';
import { Slider } from '~/components/ui/slider';
import { Switch } from '~/components/ui/switch';
import { Textarea } from '~/components/ui/textarea';
import { useUpdateRepoSettings } from '~/hooks/repos';
import { formatUsd } from '~/lib/format';
import { cn } from '~/lib/utils';
import { RepoSettingsFormSchema, type RepoSettingsFormValues } from '~/schemas/repo-settings';
import type { RepoSettingsPageDto } from '~/types/repo';
import { GlobEditor } from './glob-editor';

const INSTRUCTIONS_MAX = RepoSettingsSchema.shape.instructions.maxLength ?? 2000;
const MAX_FINDINGS = RepoSettingsSchema.shape.maxFindings.maxValue ?? 10;

function toValues(s: RepoSettingsDto): RepoSettingsFormValues {
  const { repoId: _repoId, updatedAt: _updatedAt, ...values } = s;
  return values;
}

function Section({
  id,
  index,
  title,
  description,
  children,
}: {
  id?: string;
  index: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id ?? index}-title`}
      className="grid scroll-mt-28 gap-5 border-t border-border py-9 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-12"
    >
      <div className="space-y-2">
        <p className="eyebrow">{index}</p>
        <h2 id={`${id ?? index}-title`} className="display text-3xl">
          {title}
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function SwitchRow({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-4 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[15px] font-medium">
          {label}
        </label>
        <p id={`${id}-desc`} className="mt-1 text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        aria-describedby={`${id}-desc`}
        className="mt-0.5"
      />
    </div>
  );
}

/** Spec 11.6: every repo setting, validated with the shared schema, saved through PATCH. */
export function RepoSettingsForm({ page }: { page: RepoSettingsPageDto }) {
  const update = useUpdateRepoSettings(page.repo.id);
  const form = useForm<RepoSettingsFormValues>({
    resolver: zodResolver(RepoSettingsFormSchema) as Resolver<RepoSettingsFormValues>,
    defaultValues: toValues(page.settings),
    mode: 'onChange',
  });
  const { control, register, handleSubmit, reset, setValue, formState } = form;
  const { errors, isDirty } = formState;

  useEffect(() => reset(toValues(page.settings)), [page.settings, reset]);

  const onSubmit = handleSubmit((values) =>
    update.mutate(
      { ...values, ignoreGlobs: values.ignoreGlobs.map((g) => g.trim()) },
      {
        onSuccess: (saved) => {
          reset(toValues(saved));
          toast.success('Settings saved', {
            description: `The next review on ${page.repo.fullName} uses them.`,
          });
        },
      },
    ),
  );

  const [threshold, instructions, globs, budget, enabled] = useWatch({
    control,
    name: ['threshold', 'instructions', 'ignoreGlobs', 'monthlyBudgetUsd', 'enabled'],
  });
  const tone = TONE_CLASSES[scoreTone(Math.max(0, threshold - 1))];

  return (
    <form onSubmit={onSubmit} noValidate className="pb-28" aria-label={`Settings for ${page.repo.fullName}`}>
      {page.canEdit ? null : (
        <p
          role="note"
          className="mb-8 rounded-2xl border border-border bg-paper-sunken px-4 py-3 text-sm text-ink-soft"
        >
          View only. Changing these settings needs the Maintain or Admin role on this repo on GitHub.
        </p>
      )}
      <fieldset
        disabled={!page.canEdit}
        className="min-w-0 disabled:[&_[role=switch]]:opacity-60 disabled:[&_label]:cursor-not-allowed"
      >
        <Section
          index="01"
          title="Reviews"
          description="When Revo runs on this repo, and how loud it is on GitHub."
        >
          <div className="divide-y divide-border rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
            <Controller
              control={control}
              name="enabled"
              render={({ field }) => (
                <SwitchRow
                  id="enabled"
                  label="Reviews enabled"
                  description={
                    field.value
                      ? 'New and updated pull requests are reviewed.'
                      : 'Paused: nothing is reviewed or posted.'
                  }
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={control}
              name="reviewDrafts"
              render={({ field }) => (
                <SwitchRow
                  id="reviewDrafts"
                  label="Review draft PRs"
                  description="Off by default: drafts change a lot and cost money."
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={control}
              name="reviewBots"
              render={({ field }) => (
                <SwitchRow
                  id="reviewBots"
                  label="Review bot PRs"
                  description="Dependabot, Renovate and other bots are skipped unless this is on."
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
            <Controller
              control={control}
              name="inlineComments"
              render={({ field }) => (
                <SwitchRow
                  id="inlineComments"
                  label="Inline comments"
                  description="Majors and blockers also get a comment on their line. The summary comment is always posted."
                  checked={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
        </Section>

        <Section
          index="02"
          title="Model"
          description="Both passes, find and verify, use this model. Prices per million tokens."
        >
          <Controller
            control={control}
            name="model"
            render={({ field }) => (
              <fieldset className="grid gap-3 sm:grid-cols-3">
                <legend className="sr-only">Model</legend>
                {page.models.map((m) => {
                  const checked = field.value === m.id;
                  return (
                    <label
                      key={m.id}
                      className={cn(
                        'relative flex cursor-pointer flex-col rounded-3xl border bg-card p-5 shadow-card transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                        checked
                          ? 'border-accent-brand ring-1 ring-accent-brand'
                          : 'border-border hover:border-foreground/25',
                      )}
                    >
                      <input
                        type="radio"
                        name={field.name}
                        value={m.id}
                        checked={checked}
                        onChange={() => field.onChange(m.id)}
                        className="sr-only"
                      />
                      <span className="flex items-center justify-between gap-2">
                        <span className="display text-2xl">{m.name.replace('Claude ', '')}</span>
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid size-4 place-items-center rounded-full border',
                            checked ? 'border-accent-brand' : 'border-border',
                          )}
                        >
                          {checked ? <span className="size-2 rounded-full bg-accent-brand" /> : null}
                        </span>
                      </span>
                      <span className="mt-2 flex-1 text-sm text-muted-foreground">{m.description}</span>
                      <span className="mt-4 border-t border-border pt-3 font-mono text-[0.6875rem] text-ink-soft">
                        {formatUsd(m.inputPerMTok)} in · {formatUsd(m.outputPerMTok)} out
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
          />
        </Section>

        <Section
          index="03"
          title="What to check"
          description="Categories the model looks for. Style and naming are never reported."
        >
          <Controller
            control={control}
            name="categories"
            render={({ field }) => (
              <fieldset aria-describedby={errors.categories ? 'categories-error' : undefined}>
                <legend className="sr-only">Categories checked</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {CATEGORIES.map((c) => {
                    const on = field.value.includes(c);
                    return (
                      <label
                        key={c}
                        className={cn(
                          'flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
                          on
                            ? 'border-foreground/25 bg-card shadow-card'
                            : 'border-dashed border-border text-muted-foreground',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() =>
                            field.onChange(
                              on
                                ? field.value.filter((x) => x !== c)
                                : CATEGORIES.filter((x) => x === c || field.value.includes(x)),
                            )
                          }
                        />
                        <span
                          aria-hidden="true"
                          className={cn(
                            'mt-0.5 grid size-4 shrink-0 place-items-center rounded-[5px] border transition-colors',
                            on ? 'border-foreground bg-foreground text-background' : 'border-border',
                          )}
                        >
                          {on ? (
                            <svg
                              viewBox="0 0 12 12"
                              className="size-2.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M2.5 6.5l2.2 2.2L9.5 3.8" />
                            </svg>
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className={cn('block font-mono text-[13px]', on && 'text-foreground')}>
                            #{c}
                          </span>
                          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            <span className="sr-only">{CATEGORY_LABELS[c]}: </span>
                            {CATEGORY_DESCRIPTIONS[c]}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {errors.categories ? (
                  <p id="categories-error" role="alert" className="mt-3 text-sm text-bad-ink">
                    {errors.categories.message}
                  </p>
                ) : null}
              </fieldset>
            )}
          />
        </Section>

        <Section
          index="04"
          title="Score"
          description="The check turns red under the threshold, or with any blocker."
        >
          <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <div className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
              <div className="flex items-baseline justify-between gap-4">
                <p id="threshold-label" className="text-[15px] font-medium">
                  Threshold for red
                </p>
                <span className="display tabular text-5xl leading-none" aria-hidden="true">
                  {threshold}
                </span>
              </div>
              <Controller
                control={control}
                name="threshold"
                render={({ field }) => (
                  <Slider
                    className="mt-6"
                    min={0}
                    max={100}
                    step={1}
                    value={[field.value]}
                    onValueChange={([v]) => field.onChange(v ?? 0)}
                    disabled={!page.canEdit}
                    thumbLabel="Threshold for red"
                    thumbValueText={(v) =>
                      v === 0 ? '0, only blockers turn the check red' : `${v}, red from ${v - 1} down`
                    }
                  />
                )}
              />
              <p className="mt-4 font-mono text-xs text-muted-foreground">
                {threshold === 0 ? (
                  'Only blockers turn the check red'
                ) : (
                  <>
                    Red from <span className={tone.ink}>{threshold - 1}</span> down (
                    {SCORE_LABEL_TEXT[scoreLabel(threshold - 1)].toLowerCase()})
                  </>
                )}{' '}
                · default 70
              </p>
            </div>
            <div className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
              <p id="max-findings-label" className="text-[15px] font-medium">
                Max findings posted
              </p>
              <Controller
                control={control}
                name="maxFindings"
                render={({ field }) => (
                  <div
                    className="mt-4 flex items-center gap-4"
                    role="group"
                    aria-labelledby="max-findings-label"
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="One fewer"
                      disabled={field.value <= 1}
                      onClick={() => field.onChange(field.value - 1)}
                    >
                      −
                    </Button>
                    <output
                      className="display tabular w-12 text-center text-5xl leading-none"
                      aria-live="polite"
                    >
                      {field.value}
                    </output>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="One more"
                      disabled={field.value >= MAX_FINDINGS}
                      onClick={() => field.onChange(field.value + 1)}
                    >
                      +
                    </Button>
                  </div>
                )}
              />
              <p className="mt-4 font-mono text-xs text-muted-foreground">
                Few comments, all important · default 5
              </p>
            </div>
          </div>
        </Section>

        <Section
          index="05"
          title="Ignored files"
          description="Glob patterns from the repo root. Matching files are never sent to the model."
        >
          <div className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
            <GlobEditor
              globs={globs}
              errors={Array.isArray(errors.ignoreGlobs) ? errors.ignoreGlobs : undefined}
              onChange={(next) => setValue('ignoreGlobs', next, { shouldDirty: true, shouldValidate: true })}
              builtIn={page.builtInIgnoreGlobs}
            />
            {errors.ignoreGlobs && !Array.isArray(errors.ignoreGlobs) ? (
              <p role="alert" className="mt-3 text-sm text-bad-ink">
                {errors.ignoreGlobs.message}
              </p>
            ) : null}
          </div>
        </Section>

        <Section
          index="06"
          title="Custom instructions"
          description="House rules the model reads after its fixed prompt, e.g. “We use Zod for all input validation.”"
        >
          <div className="space-y-2">
            <label htmlFor="instructions" className="sr-only">
              Custom instructions
            </label>
            <Textarea
              id="instructions"
              rows={6}
              {...register('instructions')}
              aria-invalid={Boolean(errors.instructions)}
              aria-describedby="instructions-count"
              placeholder="We use Zod for all input validation. Prices are integers in cents."
              className="min-h-36 bg-card leading-relaxed"
            />
            <div className="flex items-center justify-between gap-3">
              {errors.instructions ? (
                <p role="alert" className="text-sm text-bad-ink">
                  {errors.instructions.message}
                </p>
              ) : (
                <span />
              )}
              <span
                id="instructions-count"
                className={cn(
                  'tabular font-mono text-xs',
                  instructions.length > INSTRUCTIONS_MAX
                    ? 'text-bad-ink'
                    : instructions.length > INSTRUCTIONS_MAX * 0.9
                      ? 'text-warn-ink'
                      : 'text-muted-foreground',
                )}
              >
                {instructions.length.toLocaleString('en-US')} / {INSTRUCTIONS_MAX.toLocaleString('en-US')}
              </span>
            </div>
          </div>
        </Section>

        <Section
          id="budget"
          index="07"
          title="Monthly budget"
          description="When this month’s reviews cost this much, reviews stop until the 1st."
        >
          <div className="space-y-4 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
            <BudgetBanner
              budgets={page.budget.reached && enabled ? [page.budget] : []}
              showSettingsLink={false}
            />
            <div className="grid gap-6 sm:grid-cols-[14rem_minmax(0,1fr)] sm:items-end">
              <div className="space-y-2">
                <label htmlFor="monthlyBudgetUsd" className="text-[15px] font-medium">
                  Budget (USD)
                </label>
                <InputGroup className="h-11">
                  <InputGroupAddon className="font-mono">$</InputGroupAddon>
                  <InputGroupInput
                    id="monthlyBudgetUsd"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={1}
                    {...register('monthlyBudgetUsd', { valueAsNumber: true })}
                    aria-invalid={Boolean(errors.monthlyBudgetUsd)}
                    className="tabular font-mono"
                  />
                </InputGroup>
                {errors.monthlyBudgetUsd ? (
                  <p role="alert" className="text-sm text-bad-ink">
                    Enter an amount from $0 to $10,000.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <p className="flex items-baseline justify-between gap-3 font-mono text-xs">
                  <span className="text-muted-foreground">Spent this month</span>
                  <span className="tabular">
                    {formatUsd(page.budget.spentUsd)}
                    <span className="text-muted-foreground">
                      {' '}
                      / {Number.isFinite(budget) ? formatUsd(budget) : '—'}
                    </span>
                  </span>
                </p>
                <Meter
                  value={page.budget.spentUsd}
                  max={Number.isFinite(budget) ? budget : 0}
                  kind="budget"
                  label="Spent this month against the budget"
                />
              </div>
            </div>
            <p className="font-mono text-[0.6875rem] text-muted-foreground">
              Set $0 to stop reviews on this repo at once.
            </p>
          </div>
        </Section>
      </fieldset>

      <AnimatePresence>
        {isDirty ? (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 24 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-center px-3"
          >
            <div
              role="region"
              aria-label="Unsaved changes"
              className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-full border border-border/70 bg-glass py-2 pr-2 pl-4 shadow-float backdrop-blur-xl sm:gap-3 sm:pl-5"
            >
              <span className="relative flex size-2" aria-hidden="true">
                <span className="absolute inset-0 animate-ping rounded-full bg-accent-brand opacity-50" />
                <span className="relative size-2 rounded-full bg-accent-brand" />
              </span>
              <span className="mr-auto truncate text-sm">
                Unsaved<span className="hidden sm:inline"> changes</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => reset(toValues(page.settings))}>
                Discard
              </Button>
              <Button type="submit" variant="accent" size="sm" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </form>
  );
}
