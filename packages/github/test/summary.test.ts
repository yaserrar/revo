import { describe, expect, it } from 'vitest';
import { SUMMARY_MARKER } from '@revo/shared';
import { failedCheck, resultCheck, skippedCheck } from '../src/checks';
import { partialCoverage } from '../src/summary';
import {
  excerpt,
  formatCost,
  formatDuration,
  formatTokens,
  lineUrl,
  renderCheckSummary,
  renderSummaryComment,
  type SummaryInput,
} from '../src/summary';

const SHA = 'a4495bf0c2d1e8f7a6b5c4d3e2f1a0b9c8d7e6f5';

const base: SummaryInput = {
  score: 72,
  label: 'needs_a_look',
  passed: true,
  threshold: 70,
  previousScore: 58,
  breakdown: [
    { severity: 'blocker', count: 0, points: 0 },
    { severity: 'major', count: 2, points: -24 },
    { severity: 'minor', count: 1, points: -4 },
  ],
  findings: [
    {
      category: 'bug',
      severity: 'major',
      file: 'src/api/orders.ts',
      lineStart: 44,
      lineEnd: 46,
      title: 'Discount applied after tax',
      explanation: 'Customers with a promo code pay too much.',
      suggestion: 'Apply the discount to the subtotal before computing tax.',
      confidence: 0.9,
      snippet: Array.from({ length: 12 }, (_, i) => `line ${38 + i}`).join('\n'),
      snippetStartLine: 38,
      inlineUrl: 'https://github.com/acme/shop/pull/7#discussion_r99',
    },
    {
      category: 'missing-test',
      severity: 'minor',
      file: 'src/lib/pricing.ts',
      lineStart: 18,
      lineEnd: 18,
      title: 'No test for | the discount',
      explanation: 'The new discount logic has no test.',
      suggestion: 'Add a unit test for promo codes.',
      originalSeverity: 'major',
    },
  ],
  maxFindings: 5,
  rejectedCount: 2,
  categories: ['bug', 'security'],
  reviewedFiles: ['src/api/orders.ts', 'src/lib/pricing.ts'],
  notReviewed: [
    { path: 'pnpm-lock.yaml', reason: 'ignored' },
    { path: 'src/old.ts', reason: 'removed' },
  ],
  changedFiles: 4,
  changedLines: 320,
  notes: [],
  modelName: 'Claude Sonnet 5.5',
  trigger: 'auto',
  durationMs: 41_200,
  tokensIn: 40_100,
  tokensOut: 3_312,
  costUsd: 0.181,
  headSha: SHA,
  repoUrl: 'https://github.com/acme/shop',
  dashboardUrl: 'https://revo.example.com/prs/pr_1',
  settingsUrl: 'https://revo.example.com/repos/repo_1/settings',
};

const clean: SummaryInput = {
  ...base,
  score: 100,
  label: 'good_to_merge',
  previousScore: null,
  findings: [],
  rejectedCount: 0,
  breakdown: base.breakdown.map((r) => ({ ...r, count: 0, points: 0 })),
};

const large: SummaryInput = {
  ...clean,
  reviewedFiles: Array.from({ length: 10 }, (_, i) => `src/r${i}.ts`),
  notReviewed: Array.from({ length: 59 }, (_, i) => ({
    path: `src/f${i}.ts`,
    reason: 'size_limit' as const,
  })),
  changedFiles: 83,
  changedLines: 14_210,
  notes: ['Large PR: reviewed 10 of 69 files.'],
};

describe('renderSummaryComment (spec 10)', () => {
  it('opens with the marker, the verdict, the check result, the commit and the delta', () => {
    const lines = renderSummaryComment(base).split('\n');
    expect(lines[0]).toBe(SUMMARY_MARKER);
    expect(lines[1]).toBe('## 🟡 Revo · 72/100 · Needs a look');
    expect(lines[3]).toBe(
      '✅ **Check passed**: no blockers and the score is at or above the repo’s threshold of 70.',
    );
    expect(lines[5]).toBe(
      `Reviewed commit [\`a4495bf\`](https://github.com/acme/shop/commit/${SHA}) · Previous review: 58 → 72 (+14)`,
    );
  });

  it('explains a failed check: blocker first, then the threshold', () => {
    const blocker = renderSummaryComment({
      ...base,
      score: 58,
      label: 'changes_needed',
      passed: false,
      breakdown: [{ severity: 'blocker', count: 1, points: -30 }, base.breakdown[1]!, base.breakdown[2]!],
    });
    expect(blocker).toContain('❌ **Check failed**: 1 blocker found. Any blocker fails the check');
    expect(blocker).toContain('## 🔴 Revo · 58/100 · Changes needed');
    expect(blocker).toContain('**Score:** 100 − 30 (1 blocker) − 24 (2 majors) − 4 (1 minor) = **58**');
    const low = renderSummaryComment({ ...base, passed: false, threshold: 80 });
    expect(low).toContain('❌ **Check failed**: the score is under the repo’s threshold of 80.');
  });

  it('notes when minors hit their cap', () => {
    const md = renderSummaryComment({
      ...base,
      breakdown: [base.breakdown[0]!, base.breakdown[1]!, { severity: 'minor', count: 5, points: -12 }],
    });
    expect(md).toContain('− 12 (5 minors, capped)');
  });

  it('lists every problem in a table with links to the lines at the reviewed commit', () => {
    const md = renderSummaryComment(base);
    expect(md).toContain('| **72** / 100 | 0 | 2 | 1 | 2 |');
    expect(md).toContain(
      `| 1 | 🟠 Major | Bug | [\`src/api/orders.ts:44-46\`](https://github.com/acme/shop/blob/${SHA}/src/api/orders.ts#L44-L46) | Discount applied after tax |`,
    );
    // A pipe in model text or in a path cannot break the table.
    expect(md).toContain('| No test for \\| the discount |');
    const piped = renderSummaryComment({ ...base, findings: [{ ...base.findings[1]!, file: 'src/a|b.ts' }] });
    expect(piped).toContain('[`src/a\\|b.ts:18`](https://github.com/acme/shop/blob/');
  });

  it('details each problem: open for majors, closed for minors, with code, fix and context', () => {
    const md = renderSummaryComment(base);
    expect(md).toContain(
      '<details open>\n<summary><b>1. 🟠 Major · Bug: Discount applied after tax</b></summary>',
    );
    expect(md).toContain(
      '<details>\n<summary><b>2. 🟡 Minor · Missing test: No test for | the discount</b></summary>',
    );
    expect(md).toContain(
      '· confidence 90% · [discussed inline](https://github.com/acme/shop/pull/7#discussion_r99)',
    );
    expect(md).toContain('lowered from Major by verification');
    expect(md).toContain('**Problem.** Customers with a promo code pay too much.');
    expect(md).toContain('**Suggested fix.** Apply the discount to the subtotal before computing tax.');
    expect(md).toContain('<sub>lines 41–49 · flagged: lines 44–46</sub>\n\n```ts\nline 41\n');
  });

  it('puts a multi-line fix (fenced code) under its label', () => {
    const md = renderSummaryComment({
      ...base,
      findings: [{ ...base.findings[0]!, suggestion: '```ts\nif (!ok) return 403;\n```' }],
    });
    expect(md).toContain('**Suggested fix.**\n\n```ts\nif (!ok) return 403;\n```');
  });

  it('says when the repo limit may hide more problems', () => {
    expect(renderSummaryComment({ ...base, maxFindings: 2 })).toContain(
      '_Showing the 2 most important problems: this repo posts at most 2 per review, so there may be more._',
    );
    expect(renderSummaryComment(base)).not.toContain('there may be more');
  });

  it('counts dismissed problems without posting them', () => {
    expect(renderSummaryComment(base)).toContain(
      '_2 other possible problems were dismissed (disproved by the second pass',
    );
    expect(renderSummaryComment(clean)).not.toContain('dismissed');
  });

  it('shows coverage: reviewed and not reviewed files by reason', () => {
    const md = renderSummaryComment(base);
    expect(md).toContain('All 2 reviewable files reviewed.');
    expect(md).toContain(
      '2 other changed files not reviewed: 1 skipped by ignore rules, 1 deleted in this PR.',
    );
    expect(md).toContain('<details><summary>Reviewed files (2)</summary>\n\n- `src/api/orders.ts`');
    expect(md).toContain('**Deleted in this PR** (1)');
  });

  it('flags a partial review of a large PR at the top, in the headline and the check title', () => {
    const md = renderSummaryComment(large);
    const lines = md.split('\n');
    expect(lines[1]).toBe('## 🟢 Revo · 100/100 · Good to merge · partial review');
    expect(lines[3]).toContain('threshold of 70, on the reviewed files only.');
    expect(lines[5]).toBe(
      '⚠️ **Partial review: 10 of 69 files.** This PR changes 14,210 lines in 83 files. Revo reviews up to 10,000 changed lines or 100 files per PR (after skipping lockfiles and generated code): files changed since the last review first, then the highest-risk paths. The score covers only the reviewed files: split the PR for a full review.',
    );
    expect(md).toContain('| **100** / 100 | 0 | 0 | 0 | 10 of 69 |');
    expect(md).toContain('- …and 19 more (listed in the dashboard)');
    expect(md).not.toContain('Large PR: reviewed');
    expect(partialCoverage(large)).toBe('10 of 69 files reviewed');
    expect(partialCoverage(base)).toBeNull();
  });

  it('names the token limit when files were dropped to fit one pass, not the line limits', () => {
    const budget: SummaryInput = {
      ...base,
      changedLines: 3_200,
      reviewedFiles: ['src/api/orders.ts'],
      notReviewed: [{ path: 'src/fixtures/big.ts', reason: 'token_budget' }],
    };
    const md = renderSummaryComment(budget);
    expect(md).toContain('⚠️ **Partial review: 1 of 2 files.**');
    expect(md).toContain('The reviewed files filled the 400,000-token limit of one review pass: files changed since');
    expect(md).not.toContain('10,000 changed lines');
    expect(md).toContain('1 over the token limit');
    expect(partialCoverage(budget)).toBe('1 of 2 files reviewed');
  });

  it('renders the 100/100 variant without a problems section', () => {
    const md = renderSummaryComment(clean);
    expect(md).toContain('## 🟢 Revo · 100/100 · Good to merge');
    expect(md).toContain('No problems found in the 2 reviewed files.');
    expect(md).not.toContain('Previous review');
    expect(md).not.toContain('### Problems');
  });

  it('explains the score and the checked categories, and ends with run details and links', () => {
    const md = renderSummaryComment({ ...base, trigger: 'manual' });
    expect(md).toContain('<details><summary>How the score works</summary>');
    expect(md).toContain('The check fails on any blocker or a score under 70.');
    expect(md).toContain('This repo posts at most 5 per review.');
    expect(md).toContain('Checked for this repo: Bug, Security.');
    expect(md.split('\n').at(-1)).toBe(
      'Claude Sonnet 5.5 · run with Review again · 41 s · 40k tokens in, 3.3k out · $0.18 · [Open in dashboard](https://revo.example.com/prs/pr_1) · [Repo settings](https://revo.example.com/repos/repo_1/settings)',
    );
  });

  it('sanitizes model text everywhere, including inside <summary>', () => {
    const md = renderSummaryComment({
      ...base,
      findings: [
        {
          ...base.findings[0]!,
          title: '<img src=x> ping `@octo-org/security` and @octocat',
          explanation:
            'end --> <!-- revo:summary --> See \\` @admin <img src="https://evil.example/p.png"> `',
        },
      ],
    });
    expect(md).not.toContain('<img');
    // Prose mentions are broken; a mention inside a real code span (table cell) is never linked by GitHub.
    expect(md).not.toMatch(/@(octocat|admin)/);
    expect(md).toContain('| &lt;img src=x> ping `@octo-org/security` and @\u200boctocat |');
    expect(md).toContain('<code>@​octo-org/security</code>');
    expect(md.split(SUMMARY_MARKER).length).toBe(2);
  });

  it('always fits GitHub’s size limit, dropping detail step by step', () => {
    const long = 'x'.repeat(800);
    const huge: SummaryInput = {
      ...base,
      maxFindings: 10,
      findings: Array.from({ length: 10 }, (_, i) => ({
        ...base.findings[0]!,
        file: `src/${'deep/'.repeat(40)}file-${i}.ts`,
        title: 'T'.repeat(100),
        explanation: long,
        suggestion: long,
        snippet: Array.from({ length: 30 }, () => 'y'.repeat(1_000)).join('\n'),
        snippetStartLine: 30,
      })),
      reviewedFiles: Array.from({ length: 300 }, (_, i) => `src/${'long-folder-name/'.repeat(15)}${i}.ts`),
      notReviewed: Array.from({ length: 300 }, (_, i) => ({
        path: `vendor/${'x'.repeat(250)}${i}`,
        reason: 'ignored' as const,
      })),
    };
    const md = renderSummaryComment(huge);
    expect(md.length).toBeLessThanOrEqual(60_000);
    expect(renderCheckSummary(huge).length).toBeLessThanOrEqual(60_000);
    expect(md.startsWith(SUMMARY_MARKER)).toBe(true);
    // Long code lines are shortened in excerpts.
    expect(renderSummaryComment({ ...base, findings: [huge.findings[0]!] })).toContain(
      `${'y'.repeat(180)} …`,
    );
  });

  it('builds the check summary without the marker or headline, with run details', () => {
    const summary = renderCheckSummary(base);
    expect(summary).not.toContain(SUMMARY_MARKER);
    expect(summary.startsWith('✅ **Check passed**')).toBe(true);
    expect(summary).toContain('### Problems');
    expect(summary).toContain('[Open in dashboard](https://revo.example.com/prs/pr_1)');
  });
});

describe('formatting', () => {
  it('formats durations, costs and tokens', () => {
    expect(formatDuration(41_200)).toBe('41 s');
    expect(formatDuration(65_000)).toBe('1 min 5 s');
    expect(formatDuration(120_000)).toBe('2 min');
    expect(formatCost(0.181)).toBe('$0.18');
    expect(formatCost(0.004)).toBe('<$0.01');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatTokens(950)).toBe('950');
    expect(formatTokens(4_250)).toBe('4.3k');
    expect(formatTokens(43_412)).toBe('43k');
    expect(formatTokens(1_250_000)).toBe('1.3M');
  });

  it('links to lines with encoded paths', () => {
    expect(lineUrl('https://github.com/a/b/', 'abc', 'src/app/[id]/page #1.tsx', 3, 3)).toBe(
      'https://github.com/a/b/blob/abc/src/app/%5Bid%5D/page%20%231.tsx#L3',
    );
  });

  it('cuts an excerpt around the flagged lines from the stored snippet', () => {
    expect(excerpt(base.findings[0]!)).toMatchObject({ from: 41, to: 49 });
    expect(excerpt(base.findings[1]!)).toBeNull();
    expect(excerpt({ ...base.findings[0]!, lineStart: 100, lineEnd: 100 })).toBeNull();
    expect(
      excerpt({ ...base.findings[0]!, snippet: 'a\r\nb\r\nc', snippetStartLine: 44, lineEnd: 44 })?.code,
    ).toBe('a\nb\nc');
  });
});

describe('check presentations (spec 7.8)', () => {
  it('adds partial coverage to the check title', () => {
    expect(
      resultCheck({
        score: 100,
        label: 'good_to_merge',
        passed: true,
        summary: 's',
        partialCoverage: '10 of 69 files reviewed',
      }).title,
    ).toBe('Score 100/100, good to merge (10 of 69 files reviewed)');
  });

  it('maps the result to success or failure with the score title', () => {
    expect(resultCheck({ score: 72, label: 'needs_a_look', passed: true, summary: 's' })).toMatchObject({
      conclusion: 'success',
      title: 'Score 72/100, needs a look',
    });
    expect(resultCheck({ score: 58, label: 'changes_needed', passed: false, summary: 's' }).status).toBe(
      'completed',
    );
  });

  it('uses neutral for skips and failures', () => {
    expect(skippedCheck('budget')).toMatchObject({ conclusion: 'neutral', title: 'Monthly budget reached' });
    expect(failedCheck()).toMatchObject({ conclusion: 'neutral', title: "Revo couldn't review this PR" });
  });
});
