import type { BenchCase } from './cases';
import { LINE_TOLERANCE, type BenchSummary, type CaseResult, type FindingLabel } from './score';

export type BenchRun = {
  startedAt: string;
  finishedAt: string | null;
  engine: string;
  model: string;
  effort: string;
  label: string;
  /** The repo the cases come from (path or URL) and the clone used. */
  source: string;
  summary: BenchSummary;
  results: CaseResult[];
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => `$${x.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const kTokens = (n: number) => `${(n / 1000).toFixed(1)}k`;
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const where = (f: { file: string; lineStart: number; lineEnd: number }) =>
  `${f.file}:${f.lineStart}${f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ''}`;

const LABEL_TEXT: Record<FindingLabel, string> = {
  hit: 'HIT',
  duplicate: 'duplicate',
  'known-false-positive': 'KNOWN FALSE POSITIVE',
  'false-alarm': 'FALSE ALARM',
  nit: 'nit',
  extra: 'extra',
};

/** Console lines for the totals. */
export function summaryLines(run: BenchRun): string[] {
  const s = run.summary;
  return [
    `Revo bench · ${run.engine} · ${run.model} · effort ${run.effort} · ${s.cases} cases${s.failed ? ` · ${s.failed} FAILED` : ''}`,
    `  catch rate     ${s.bugsCaught}/${s.bugs} bugs (${pct(s.catchRate)}) · ${s.bugCasesFullyCaught}/${s.bugCases} bug cases fully caught` +
      `${s.droppedInPass2 ? ` · ${s.droppedInPass2} found in pass 1 but rejected in pass 2` : ''}`,
    `  false alarms   ${s.falseAlarms} on ${s.cleanCases} clean cases (${s.falseAlarmsPerCleanCase.toFixed(2)} per case) · ` +
      `${s.cleanCasesQuiet}/${s.cleanCases} clean cases quiet · ${s.nits} minor nits`,
    `  known FPs      ${s.knownFalsePositives} seen again · ${s.extraFindings} extra findings on bug cases`,
    `  tokens / case  ${kTokens(s.avgTokens.total)} (in ${kTokens(s.avgTokens.input)}, cache read ${kTokens(s.avgTokens.cacheRead)}, ` +
      `cache write ${kTokens(s.avgTokens.cacheWrite)}, out ${kTokens(s.avgTokens.output)})`,
    `  cost / case    ${usd(s.avgApiEquivalentUsd)} at API prices (total ${usd(s.totalApiEquivalentUsd)}) · billed ${usd(s.totalBilledUsd)}${run.engine === 'fake' ? ' (simulated)' : ''}`,
    `  time / case    ${secs(s.avgDurationMs)} (max ${secs(s.maxDurationMs)}, total ${secs(s.totalDurationMs)})`,
  ];
}

/** The markdown report saved next to the JSON in bench/results/. */
export function renderMarkdown(run: BenchRun, cases: readonly BenchCase[]): string {
  const s = run.summary;
  const byId = new Map(cases.map((c) => [c.id, c]));
  const out: string[] = [
    `# Revo bench · ${run.startedAt.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Engine \`${run.engine}\` · model \`${run.model}\` · effort \`${run.effort}\`${run.label ? ` · label \`${run.label}\`` : ''} · ` +
      `${s.cases} cases from \`${run.source}\`${run.finishedAt ? '' : ' · **incomplete run**'}`,
    '',
    '## Totals',
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Catch rate (planted + synthetic bugs) | **${s.bugsCaught}/${s.bugs} (${pct(s.catchRate)})** · ${s.bugCasesFullyCaught}/${s.bugCases} cases fully caught |`,
    `| Found in pass 1, rejected by pass 2 | ${s.droppedInPass2} |`,
    `| False alarms on clean cases (blocker/major + known false positives) | **${s.falseAlarms} on ${s.cleanCases} (${s.falseAlarmsPerCleanCase.toFixed(2)} per clean case)** · ${s.cleanCasesQuiet}/${s.cleanCases} quiet |`,
    `| Minor nits on clean cases (accepted) | ${s.nits} (${s.nitsPerCleanCase.toFixed(2)} per clean case) |`,
    `| Known false positives seen again | ${s.knownFalsePositives} |`,
    `| Extra findings on bug cases (not scored) | ${s.extraFindings} |`,
    `| Tokens per case (avg) | ${kTokens(s.avgTokens.total)}: ${kTokens(s.avgTokens.input)} in, ${kTokens(s.avgTokens.cacheRead)} cache read, ${kTokens(s.avgTokens.cacheWrite)} cache write, ${kTokens(s.avgTokens.output)} out |`,
    `| Cost per case at API prices (avg) | ${usd(s.avgApiEquivalentUsd)} (total ${usd(s.totalApiEquivalentUsd)}) |`,
    `| Billed | ${usd(s.totalBilledUsd)}${run.engine === 'claude-subscription' ? ' (Claude subscription)' : run.engine === 'fake' ? ' (fake engine: simulated)' : ''} |`,
    `| Time per case (avg / max) | ${secs(s.avgDurationMs)} / ${secs(s.maxDurationMs)} (total ${secs(s.totalDurationMs)}) |`,
    `| Failed cases | ${s.failed} |`,
    '',
    '## Per case',
    '',
    '| Case | Kind | Result | Posted findings | Rejected in pass 2 | Tokens | API-price cost | Time |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const r of run.results) {
    const posted = r.error
      ? `error: ${cell(r.error)}`
      : r.findings
          .map(
            (f, i) =>
              `${LABEL_TEXT[r.score?.labels[i] ?? 'extra']}: ${f.severity} "${cell(f.title)}" @ ${where(f)}`,
          )
          .join('<br>') || '-';
    const rejected = r.rejected.map((f) => `"${cell(f.title)}" @ ${where(f)}`).join('<br>') || '-';
    const t = r.tokens;
    out.push(
      `| ${r.id} | ${r.kind} | ${r.outcome}${r.expected.length ? ` (${r.score?.caught.length ?? 0}/${r.expected.length})` : ''} | ` +
        `${posted} | ${rejected} | ${kTokens(t.input + t.cacheRead + t.cacheWrite + t.output)} | ${usd(r.apiEquivalentUsd)} | ${secs(r.durationMs)} |`,
    );
  }

  out.push(
    '',
    '## Expected bugs',
    '',
    '| Case | Bug | Where | Result | What it is |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const r of run.results) {
    for (const e of r.expected) {
      const result = r.score?.caught.includes(e.id)
        ? 'caught'
        : r.score?.droppedInPass2.includes(e.id)
          ? 'missed (rejected in pass 2)'
          : r.error
            ? 'failed'
            : 'missed';
      out.push(`| ${r.id} | ${e.id} (${e.severity}) | ${where(e)} | ${result} | ${cell(e.description)} |`);
    }
  }

  const toConfirm = run.results.flatMap((r) => {
    const c = byId.get(r.id);
    return [
      ...(c?.confirm ? [`- **${r.id}** (case label): ${c.confirm}`] : []),
      ...r.expected.filter((e) => e.confirm).map((e) => `- **${r.id} / ${e.id}**: ${e.confirm}`),
    ];
  });
  if (toConfirm.length > 0) out.push('', '## Labels to confirm', '', ...toConfirm);

  out.push(
    '',
    '## How it is scored',
    '',
    `A posted finding hits an expected bug when it is in the same file and its lines overlap the bug's lines ± ${LINE_TOLERANCE} ` +
      '(category and wording are not compared). Each bug is credited once. On clean cases, a blocker or major finding is a false ' +
      'alarm and a minor one is an accepted nit; a finding matching `bench/known-false-positives.json` (file + keyword) is a false ' +
      'alarm wherever it appears. Extra findings on bug cases are listed but not scored: read them, some may be real. ' +
      '"API-price cost" prices the tokens with Revo\'s price table (`packages/review/src/pricing.ts`), i.e. what the review would ' +
      'cost through the API engine; on the subscription nothing is billed per review.',
  );
  return out.join('\n') + '\n';
}
