'use client';

import { Add, Chart, Coin1, DocumentCode, Like1, Refresh2, TaskSquare } from 'iconsax-react';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { REVIEW_STATUSES, SEVERITIES } from '@revo/shared';
import { PageHeader, MetaItem } from '~/components/layout/page-header';
import {
  CategoryChip,
  CheckChip,
  PrStateChip,
  ReviewStatusChip,
  SeverityChip,
  SeverityTally,
} from '~/components/revo/chips';
import { CodeSnippet } from '~/components/revo/code-snippet';
import { ScoreBadge, ScoreDelta } from '~/components/revo/score-badge';
import { ScoreDial } from '~/components/revo/score-dial';
import { Sparkline } from '~/components/revo/sparkline';
import { Delta, Meter, StatCard } from '~/components/revo/stat-card';
import { DatePicker } from '~/components/shared/date-picker';
import { EmptyState } from '~/components/shared/empty-state';
import { ErrorState } from '~/components/shared/error-state';
import { UserAvatar } from '~/components/shared/user-avatar';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '~/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '~/components/ui/sheet';
import { Skeleton } from '~/components/ui/skeleton';
import { Slider } from '~/components/ui/slider';
import { Switch } from '~/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '~/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';
import { Textarea } from '~/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '~/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '~/components/ui/tooltip';
import { formatRelative, formatUsd } from '~/lib/format';
import { FindingsByCategoryChart, ScoreTrendChart } from './kit-charts';
import { PRS_PER_DAY, SAMPLE_ROWS, SAMPLE_SNIPPET, SCORE_30_DAYS } from './kit-data';

const NOW = new Date('2026-11-21T12:00:00Z');

function Section({
  index,
  title,
  description,
  children,
}: {
  index: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-border py-12 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10">
      <div className="space-y-2">
        <p className="eyebrow">{index}</p>
        <h2 className="display text-3xl">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Swatch({ token, label }: { token: string; label?: string }) {
  return (
    <div className="min-w-0">
      <div className="h-14 rounded-xl border border-border" style={{ background: `var(--${token})` }} />
      <p className="mt-2 truncate font-mono text-[0.6875rem] text-foreground">--{token}</p>
      {label ? <p className="truncate text-xs text-muted-foreground">{label}</p> : null}
    </div>
  );
}

const SWATCHES: { group: string; items: [string, string?][] }[] = [
  {
    group: 'Paper & ink',
    items: [
      ['background', 'page'],
      ['card'],
      ['paper-sunken'],
      ['muted'],
      ['border'],
      ['foreground', 'ink'],
      ['muted-foreground'],
      ['ink-soft'],
    ],
  },
  {
    group: 'Accent',
    items: [['accent-brand', 'ultramarine'], ['accent-brand-soft'], ['accent-brand-ink'], ['ring']],
  },
  { group: 'Score tones', items: [['good'], ['good-soft'], ['warn'], ['warn-soft'], ['bad'], ['bad-soft']] },
  { group: 'Severities', items: [['sev-blocker'], ['sev-major'], ['sev-minor'], ['sev-minor-soft']] },
  { group: 'Code & diff', items: [['code'], ['code-highlight'], ['diff-add'], ['diff-del']] },
  {
    group: 'Chart series',
    items: [
      ['chart-1', 'accent series'],
      ['series-1'],
      ['series-2'],
      ['series-3'],
      ['series-4'],
      ['series-5'],
      ['series-6'],
    ],
  },
];

export function DesignKit() {
  const [date, setDate] = useState<Date | undefined>(new Date('2026-11-14T00:00:00Z'));
  const [threshold, setThreshold] = useState([70]);
  const [range, setRange] = useState('30d');

  return (
    <div className="pb-24">
      <PageHeader
        eyebrow="Design kit · editorial precision"
        title={
          <>
            Paper, ink, and <em className="text-accent-brand-ink">one</em> blue.
          </>
        }
        description="Warm neutrals and hairlines, a serif for the numbers that matter, a grotesk for everything you touch, and mono for what a machine would read. Colour only means something."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => toast.success('Feedback saved', { description: 'Marked as useful.' })}
            >
              <Like1 className="size-4" />
              Toast
            </Button>
            <Button variant="accent">
              <Refresh2 className="size-4" />
              Review again
            </Button>
          </>
        }
        meta={
          <>
            <MetaItem label="Display">Instrument Serif</MetaItem>
            <MetaItem label="UI">Geist</MetaItem>
            <MetaItem label="Data">Geist Mono</MetaItem>
            <MetaItem label="Accent">--accent-brand</MetaItem>
          </>
        }
      />

      <Section
        index="01"
        title="Score"
        description="The signature element. A dial of ticks, filled to the score in its tone."
      >
        <div className="grid items-center gap-10 md:grid-cols-[auto_minmax(0,1fr)]">
          <ScoreDial score={72} size="xl" className="mx-auto max-w-full" />
          <div className="space-y-8">
            <div className="flex flex-wrap items-end gap-6">
              <ScoreDial score={100} size="md" />
              <ScoreDial score={58} size="md" />
              <ScoreDial score={null} size="md" label="Skipped" />
              <ScoreDial score={94} size="sm" />
              <ScoreDial score={66} size="sm" />
            </div>
            <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
              <ScoreBadge score={100} />
              <ScoreBadge score={72} showLabel />
              <ScoreBadge score={41} showLabel />
              <ScoreBadge score={null} />
              <ScoreDelta from={58} to={72} />
              <ScoreDelta from={88} to={76} />
            </div>
          </div>
        </div>
      </Section>

      <Section
        index="02"
        title="Overview bento"
        description="Big serif figures, sparklines, and one ink tile that leads."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            emphasis
            label="Average score · 7d"
            value={88}
            unit="/ 100"
            delta={<Delta value={4} caption="vs last week" className="[&_span]:text-background/80" />}
            className="sm:col-span-2 lg:col-span-2 lg:row-span-2"
            footnote="Computed from confirmed findings only"
          >
            <Sparkline
              data={SCORE_30_DAYS.map((d) => d.score)}
              color="var(--background)"
              className="h-36 sm:h-44"
            />
          </StatCard>
          <StatCard
            label="PRs this week"
            value={34}
            icon={<TaskSquare className="size-[18px]" />}
            delta={<Delta value={6} caption="vs last week" />}
          >
            <Sparkline data={PRS_PER_DAY} />
          </StatCard>
          <StatCard
            label="Precision"
            value={91}
            unit="%"
            icon={<Like1 className="size-[18px]" />}
            footnote="42 useful · 4 wrong"
          >
            <Meter value={91} max={100} label="Findings marked useful" />
          </StatCard>
          <StatCard
            label="Spent · Nov"
            value={formatUsd(8.49)}
            icon={<Coin1 className="size-[18px]" />}
            footnote="of $60.00 across 3 repos"
          >
            <Meter value={8.49} max={60} kind="budget" label="Spent against budget" />
          </StatCard>
          <StatCard
            label="Cost per PR"
            value={formatUsd(0.11)}
            icon={<Chart className="size-[18px]" />}
            delta={<Delta value={-2} suffix="¢" upIsGood={false} caption="vs October" />}
          />
        </div>
        <div className="mt-4 rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="eyebrow">Average score · 30 days</h3>
              <p className="display mt-2 text-3xl">Trending up</p>
            </div>
            <ToggleGroup
              type="single"
              value={range}
              onValueChange={(v) => v && setRange(v)}
              variant="outline"
              size="sm"
              aria-label="Range"
            >
              <ToggleGroupItem value="7d">7d</ToggleGroupItem>
              <ToggleGroupItem value="30d">30d</ToggleGroupItem>
              <ToggleGroupItem value="90d">90d</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <ScoreTrendChart />
        </div>
      </Section>

      <Section
        index="03"
        title="Chips"
        description="Severity, category, state and status. Colour carries the meaning; text says it too."
      >
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {SEVERITIES.map((s) => (
              <SeverityChip key={s} severity={s} />
            ))}
            <SeverityChip severity="major" count={2} />
            <SeverityTally counts={{ blocker: 1, major: 2, minor: 0 }} className="ml-2" />
          </div>
          <div className="flex flex-wrap gap-2">
            {(['bug', 'security', 'performance', 'error-handling', 'data', 'missing-test'] as const).map(
              (c) => (
                <CategoryChip key={c} category={c} />
              ),
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <PrStateChip state="open" />
            <PrStateChip state="open" draft />
            <PrStateChip state="merged" />
            <PrStateChip state="closed" />
            <CheckChip passed />
            <CheckChip passed={false} />
            <CheckChip passed={null} />
          </div>
          <div className="flex flex-wrap gap-2">
            {REVIEW_STATUSES.map((s) => (
              <ReviewStatusChip key={s} status={s} skipReason={s === 'skipped' ? 'budget' : null} />
            ))}
          </div>
        </div>
      </Section>

      <Section
        index="04"
        title="Code"
        description="Shiki, both themes at once. The flagged lines carry an ultramarine rule."
      >
        <CodeSnippet
          code={SAMPLE_SNIPPET}
          path="src/lib/pricing.ts"
          startLine={40}
          highlight={{ from: 45, to: 45 }}
        />
      </Section>

      <Section
        index="05"
        title="Charts"
        description="Thin lines, recessive grid, mono ticks. Categories keep their colour everywhere."
      >
        <div className="rounded-3xl border border-border bg-card p-5 shadow-card sm:p-6">
          <h3 className="eyebrow mb-5">Findings by category · weekly</h3>
          <FindingsByCategoryChart />
        </div>
      </Section>

      <Section
        index="06"
        title="Table"
        description="Pull requests, scored. Numbers in serif, metadata in mono."
      >
        <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="eyebrow h-11 w-24 pl-5">Score</TableHead>
                <TableHead className="eyebrow">Pull request</TableHead>
                <TableHead className="eyebrow hidden md:table-cell">Findings</TableHead>
                <TableHead className="eyebrow hidden sm:table-cell">State</TableHead>
                <TableHead className="eyebrow pr-5 text-right">Reviewed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SAMPLE_ROWS.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="py-4 pl-5">
                    <ScoreBadge score={r.score} />
                  </TableCell>
                  <TableCell className="max-w-0 min-w-48 whitespace-normal">
                    <p className="truncate font-medium">{r.title}</p>
                    <p className="mt-1 flex items-center gap-2 truncate font-mono text-xs text-muted-foreground">
                      <UserAvatar login={r.author} size="sm" className="size-4" />
                      {r.repo} · #{r.number} · {r.author}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {r.status === 'running' ? (
                      <ReviewStatusChip status="running" />
                    ) : (
                      <SeverityTally counts={r.counts} />
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <PrStateChip state={r.state} />
                  </TableCell>
                  <TableCell className="pr-5 text-right font-mono text-xs whitespace-nowrap text-muted-foreground">
                    {formatRelative(new Date(NOW.getTime() - r.reviewedAgoMin * 60_000), NOW)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section index="07" title="Controls" description="Pill buttons, hairline fields, labelled everything.">
        <div className="space-y-8">
          <div className="flex flex-wrap gap-2">
            <Button>Primary</Button>
            <Button variant="accent">Accent</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Add a rule">
                  <Add className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Add a rule</TooltipContent>
            </Tooltip>
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="kit-glob">Ignored files</Label>
              <Input
                id="kit-glob"
                placeholder="docs/**"
                defaultValue="scripts/fixtures/**"
                className="font-mono text-[13px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="kit-model">Model</Label>
              <Select defaultValue="claude-sonnet-5-5">
                <SelectTrigger id="kit-model" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="claude-sonnet-5-5">Claude Sonnet 5.5</SelectItem>
                  <SelectItem value="claude-haiku-5-5">Claude Haiku 5.5</SelectItem>
                  <SelectItem value="claude-opus-5-5">Claude Opus 5.5</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="kit-instructions">Custom instructions</Label>
              <Textarea id="kit-instructions" defaultValue="We use Zod for all input validation." rows={3} />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="kit-threshold">Score threshold for red</Label>
                <span className="display tabular text-2xl leading-none">{threshold[0]}</span>
              </div>
              <Slider
                id="kit-threshold"
                value={threshold}
                onValueChange={setThreshold}
                min={0}
                max={100}
                step={1}
                aria-label="Score threshold"
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl border border-border px-4 py-3">
              <Label htmlFor="kit-drafts" className="flex flex-col items-start gap-1">
                Review draft PRs
                <span className="text-xs font-normal text-muted-foreground">
                  Off by default to save budget.
                </span>
              </Label>
              <Switch id="kit-drafts" />
            </div>
            <div className="space-y-2">
              <Label>Since</Label>
              <DatePicker value={date} onChange={setDate} label="Since date" />
            </div>
          </div>
          <Tabs defaultValue="findings">
            <TabsList>
              <TabsTrigger value="findings">Findings</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
              <TabsTrigger value="run">Run details</TabsTrigger>
            </TabsList>
            <TabsContent value="findings" className="pt-4 text-sm text-muted-foreground">
              Three confirmed findings, sorted by severity then confidence.
            </TabsContent>
            <TabsContent value="rejected" className="pt-4 text-sm text-muted-foreground">
              Two findings rejected by verification, with the reason for each.
            </TabsContent>
            <TabsContent value="run" className="pt-4 text-sm text-muted-foreground">
              Claude Sonnet 5.5 · 48.2k in · 3,120 out · 9.0k cached · $0.18 · 41 s.
            </TabsContent>
          </Tabs>
          <div className="flex flex-wrap gap-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="outline">Open dialog</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle className="display text-3xl font-normal">Mark as wrong</DialogTitle>
                  <DialogDescription>
                    Wrong findings lower the precision rate and help tune the prompts.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2">
                  <Label htmlFor="kit-note">Note (optional)</Label>
                  <Textarea id="kit-note" placeholder="Handled by the auth middleware." />
                </div>
                <DialogFooter>
                  <Button variant="outline">Cancel</Button>
                  <Button>Save feedback</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open sheet</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle className="display text-3xl font-normal">Run details</SheetTitle>
                  <SheetDescription>Tokens, cost and files of this review.</SheetDescription>
                </SheetHeader>
                <dl className="grid grid-cols-2 gap-4 px-4 font-mono text-xs">
                  <dt className="eyebrow">Model</dt>
                  <dd>Sonnet 5.5</dd>
                  <dt className="eyebrow">Cost</dt>
                  <dd>$0.18</dd>
                  <dt className="eyebrow">Files</dt>
                  <dd>9 reviewed · 2 skipped</dd>
                </dl>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </Section>

      <Section
        index="08"
        title="States"
        description="Empty, loading and error. Skeletons in content, spinners only in buttons."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <EmptyState
            icon={DocumentCode}
            title="No pull requests yet"
            description="Open a PR on an installed repo and it shows up here, scored."
            action={<Button variant="outline">Install on GitHub</Button>}
          />
          <div className="space-y-4">
            <div className="space-y-3 rounded-3xl border border-border bg-card p-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-14 w-32" />
              <Skeleton className="h-10 w-full" />
            </div>
            <ErrorState message="The server did not answer." onRetry={() => toast('Retrying…')} />
          </div>
        </div>
      </Section>

      <Section
        index="09"
        title="Tokens"
        description="Every colour is a variable in globals.css, redefined for dark."
      >
        <div className="space-y-8">
          {SWATCHES.map((g) => (
            <div key={g.group}>
              <h3 className="eyebrow mb-3">{g.group}</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {g.items.map(([token, label]) => (
                  <Swatch key={token} token={token} label={label} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section index="10" title="Type" description="Serif for figures and titles, set large and sparingly.">
        <div className="space-y-6">
          <p className="display text-7xl leading-none sm:text-8xl">72</p>
          <p className="display text-5xl leading-tight">Discount applied after tax</p>
          <p className="max-w-prose text-[15px] leading-relaxed">
            The promo amount is taken off the taxed total, so tax is charged on money the customer never
            spends. Geist carries the reading text at 15px with relaxed leading.
          </p>
          <p className="font-mono text-xs text-muted-foreground">
            src/api/orders.ts · lines 44–52 · a9c4f2d · $0.18
          </p>
          <p className="eyebrow">Eyebrow · mono · tracked uppercase</p>
        </div>
      </Section>
    </div>
  );
}
