import {
  caseVerdict,
  hits,
  matches,
  TARGETS,
  type CaseResult,
  type EvalSummary,
  type ResultFinding,
} from './metrics';

export type ModelRun = { model: string; summary: EvalSummary; results: CaseResult[] };
export type EvalRun = {
  startedAt: string;
  engine: string;
  effort: string;
  label: string;
  runs: ModelRun[];
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const usd = (x: number) => `$${x.toFixed(4)}`;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const mark = (ok: boolean) => (ok ? 'met' : 'NOT met');
const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const where = (f: Pick<ResultFinding, 'file' | 'lineStart' | 'lineEnd'>) =>
  `${f.file}:${f.lineStart}${f.lineEnd !== f.lineStart ? `-${f.lineEnd}` : ''}`;

/** Lines for the console: one summary block per model. */
export function summaryLines(model: string, s: EvalSummary): string[] {
  return [
    `model ${model} · ${s.cases} cases${s.failed ? ` · ${s.failed} failed (targets not met: incomplete run)` : ''}`,
    `  recall       ${s.bugsFound}/${s.bugCases} bugs found (${pct(s.recall)}) · target ≥ ${TARGETS.bugsFound}/10: ${mark(s.meetsTargets.recall)}`,
    `  precision    ${s.correctFindings}/${s.findings} findings correct (${pct(s.precision)})${s.duplicateFindings ? ` · ${s.duplicateFindings} duplicates` : ''}`,
    `  false alarms ${s.falseAlarms} on ${s.cleanCases} clean PRs · target ≤ ${TARGETS.maxFalseAlarms}: ${mark(s.meetsTargets.falseAlarms)}`,
    `  cost         ${usd(s.avgCostUsd)} per PR (total ${usd(s.totalCostUsd)}) · target < $${TARGETS.maxAvgCostUsd.toFixed(2)}: ${mark(s.meetsTargets.cost)}`,
    `  time         ${secs(s.avgDurationMs)} per PR`,
  ];
}

function findingText(f: ResultFinding, r: CaseResult): string {
  const hit = r.expected.some((e) => hits(f, e))
    ? 'hit'
    : r.expected.some((e) => matches(f, e))
      ? 'right place, wrong category'
      : r.expected.length
        ? 'other'
        : 'false alarm';
  return `${f.severity} ${f.category} "${cell(f.title)}" @ ${where(f)} (${hit})`;
}

/** The markdown report saved next to the JSON in eval/results/. */
export function renderMarkdown(run: EvalRun): string {
  const out: string[] = [
    `# Revo eval · ${run.startedAt.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Engine \`${run.engine}\` · effort \`${run.effort}\`${run.label ? ` · label \`${run.label}\`` : ''}`,
    '',
    '| Model | Bugs found | Precision | False alarms (clean PRs) | Avg cost / PR | Avg time / PR | Failed |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...run.runs.map(
      ({ model, summary: s }) =>
        `| ${model} | ${s.bugsFound}/${s.bugCases} (${pct(s.recall)}) | ${s.correctFindings}/${s.findings} (${pct(s.precision)}) | ` +
        `${s.falseAlarms} on ${s.cleanCases} | ${usd(s.avgCostUsd)} | ${secs(s.avgDurationMs)} | ${s.failed} |`,
    ),
    '',
    `V1 targets: at least ${TARGETS.bugsFound} of 10 bugs, at most ${TARGETS.maxFalseAlarms} false alarm on the clean PRs, under $${TARGETS.maxAvgCostUsd.toFixed(2)} per PR with Sonnet 5.5.`,
  ];
  for (const { model, summary, results } of run.runs) {
    out.push(
      '',
      `## ${model}`,
      '',
      `Recall ${mark(summary.meetsTargets.recall)}, false alarms ${mark(summary.meetsTargets.falseAlarms)}, cost ${mark(summary.meetsTargets.cost)}` +
        `${summary.meetsTargets.complete ? '' : ` (incomplete: ${summary.failed} case${summary.failed === 1 ? '' : 's'} failed)`}. ` +
        `A bug counts as found only with the right file, lines and category; ${summary.locationOnlyMatches} more were pointed at under another category` +
        `${summary.duplicateFindings ? `, and ${summary.duplicateFindings} findings repeated a bug already found` : ''}. ` +
        `${run.engine === 'fake' ? 'Simulated cost' : 'Total spend'} ${usd(summary.totalCostUsd)}.`,
      '',
      '| Case | Result | Posted findings | Rejected in pass 2 | Cost | Time |',
      '| --- | --- | --- | --- | --- | --- |',
    );
    for (const r of results) {
      const posted = r.error
        ? `error: ${cell(r.error)}`
        : r.findings.map((f) => findingText(f, r)).join('<br>') || '-';
      const rejected = (r.rejected ?? []).map((f) => `"${cell(f.title)}" @ ${where(f)}`).join('<br>') || '-';
      out.push(
        `| ${r.id} | ${caseVerdict(r)} | ${posted} | ${rejected} | ${usd(r.costUsd)} | ${secs(r.durationMs)} |`,
      );
    }
    const sized = results.filter((r) => r.estimatedTokens && r.promptTokens);
    if (sized.length > 0) {
      const ratio = sized.reduce((s, r) => s + r.estimatedTokens! / r.promptTokens!, 0) / sized.length;
      out.push(
        '',
        `Token estimate vs real prompt tokens (pass 1): ×${ratio.toFixed(2)} on average (above 1 = over-estimate, the safe side).`,
      );
    }
  }
  return out.join('\n') + '\n';
}
