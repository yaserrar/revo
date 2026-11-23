/**
 * Deterministic offline engine. It never calls an API: pass 1 matches a set
 * of known risky patterns on the ADDED lines of each patch, pass 2 rejects the
 * low-confidence ones. Usage is simulated from the size of the context so the
 * dashboard shows plausible tokens and cost. Same input, same output.
 * Select it with REVO_ENGINE=fake.
 */
import { parsePatch, type Category, type Finding, type Severity, type Verification } from '@revo/shared';
import type { CallUsage } from '../pricing';
import type { ChangedFile, EngineContext, FindResult, ReviewEngine, VerifyResult } from '../types';

type AddedLine = { line: number; text: string; before: string[] };

type Rule = {
  id: string;
  category: Category;
  severity: Severity;
  confidence: number;
  title: string;
  explanation: string;
  suggestion: string;
  /** Fake pass 2 rejects the finding with this reason. */
  rejectReason?: string;
  /** The fixed line, when the fix is a local edit (offered as a one-click change). */
  fix?: (text: string) => string;
  match: (added: AddedLine, file: ChangedFile) => boolean;
};

const near = (added: AddedLine, re: RegExp, lines = 4) => added.before.slice(-lines).some((l) => re.test(l));

const RULES: Rule[] = [
  {
    id: 'sql-string',
    category: 'security',
    severity: 'blocker',
    confidence: 0.93,
    title: 'SQL built from request input',
    explanation:
      'The query string is assembled with interpolation, so a crafted value can change the SQL that runs. Anyone who can call this code can read or delete other rows.',
    suggestion:
      'Use a parameterised query (Prisma.sql or $queryRaw with a tagged template) instead of building the string.',
    match: ({ text }) =>
      /\$(query|execute)RawUnsafe\(/.test(text) ||
      /`[^`]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^`]*\$\{/i.test(text) ||
      /['"]\s*\b(SELECT|INSERT|UPDATE|DELETE)\b[^'"]*['"]\s*\+/i.test(text),
  },
  {
    id: 'secret',
    category: 'security',
    severity: 'blocker',
    confidence: 0.95,
    title: 'Secret committed in code',
    explanation:
      'A credential is written in the source. It is now in the git history and visible to everyone with read access to the repo.',
    suggestion: 'Rotate the credential, then read it from an environment variable on the server.',
    match: ({ text }) =>
      /(api[_-]?key|secret|token|password)\w*["']?\s*[:=]\s*['"][A-Za-z0-9_-]{16,}['"]/i.test(text) ||
      /\b(sk_live_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/.test(text),
  },
  {
    id: 'body-user-id',
    category: 'security',
    severity: 'major',
    confidence: 0.86,
    title: 'User id taken from the request body',
    explanation:
      'The id of the user to act on comes from the request body, so any signed-in user can act on another user by changing it.',
    suggestion: 'Use the id from the authenticated session and ignore the one in the body.',
    match: ({ text }) => /\b(req\.)?body\.(userId|ownerId|accountId|authorId)\b/.test(text),
  },
  {
    id: 'n-plus-one',
    category: 'performance',
    severity: 'major',
    confidence: 0.81,
    title: 'Query inside a loop (N+1)',
    explanation:
      'A database or network call runs once per item. With a few hundred items this turns one request into hundreds of round trips.',
    suggestion: 'Load everything in one query (findMany with `in`, or include the relation) before the loop.',
    match: (added) =>
      /\bawait\b.*\b(prisma|db|tx)\.\w+\.(find\w*|count|update|create|delete)\(|\bawait fetch\(/.test(
        added.text,
      ) && near(added, /\bfor\s*\(|\.forEach\(|\.map\(async/),
  },
  {
    id: 'swallowed-error',
    category: 'error-handling',
    severity: 'major',
    confidence: 0.78,
    title: 'Error swallowed silently',
    explanation:
      'The failure is caught and ignored, so the caller believes the operation succeeded and nothing is logged.',
    suggestion: 'Log the error and rethrow it, or return an explicit failure the caller handles.',
    match: ({ text }) =>
      /catch\s*(\(\s*\w*\s*\))?\s*\{\s*\}/.test(text) ||
      /\.catch\(\s*\(\)\s*=>\s*(\{\s*\}|null|undefined)\s*\)/.test(text),
  },
  {
    id: 'off-by-one',
    category: 'bug',
    severity: 'major',
    confidence: 0.83,
    title: 'Loop reads one element past the end',
    explanation:
      'The loop condition uses `<=` with the length, so the last iteration reads an undefined element.',
    suggestion: 'Use `<` instead of `<=`, or iterate with for…of.',
    fix: (text) => text.replace(/<=(\s*[\w.]+\.(?:length|size)\s*;)/, '<$1'),
    match: ({ text }) => /for\s*\(.*;\s*\w+\s*<=\s*[\w.]+\.(length|size)\s*;/.test(text),
  },
  {
    id: 'discount-after-tax',
    category: 'bug',
    severity: 'major',
    confidence: 0.87,
    title: 'Discount applied after tax',
    explanation:
      'A fixed discount is subtracted from the taxed total, so customers with a promo code pay tax on money they never spend.',
    suggestion: 'Subtract the discount from the subtotal, then compute tax on the discounted amount.',
    match: ({ text }) => /\b(tax|taxed|withTax|gross)\w*\s*-\s*[\w.]*(discount|amountOff)\b/i.test(text),
  },
  {
    id: 'weak-random',
    category: 'security',
    severity: 'major',
    confidence: 0.76,
    title: 'Predictable token from Math.random',
    explanation: 'Math.random is not cryptographically secure; an attacker can predict the generated token.',
    suggestion: 'Use crypto.randomBytes or crypto.randomUUID.',
    match: ({ text }) => /(token|secret|code|nonce|resetKey)\w*\s*=.*Math\.random\(\)/i.test(text),
  },
  {
    id: 'json-parse',
    category: 'error-handling',
    severity: 'minor',
    confidence: 0.67,
    title: 'Unchecked JSON.parse on external input',
    explanation:
      'Invalid JSON throws here and the error escapes as a 500 instead of a clear validation error.',
    suggestion: 'Wrap the parse in try/catch, or validate with a Zod schema and return a 400.',
    match: (added) => /JSON\.parse\(/.test(added.text) && !near(added, /\btry\b/, 6),
  },
  {
    id: 'local-date',
    category: 'data',
    severity: 'minor',
    confidence: 0.64,
    title: 'Date parsed in the server timezone',
    explanation:
      "Day boundaries are computed in the server's local time, so users in other timezones see items on the wrong day.",
    suggestion: 'Work in UTC (Date.UTC, getUTCDate) or with an explicit timezone.',
    match: ({ text }) =>
      /\.setHours\(0,\s*0,\s*0|\.getDay\(\)|new Date\(\s*['"`]\d{4}-\d{2}-\d{2}['"`]\s*\)/.test(text),
  },
  {
    id: 'parse-int',
    category: 'bug',
    severity: 'minor',
    confidence: 0.45,
    title: 'parseInt without a radix',
    explanation: 'parseInt is called without a radix.',
    suggestion: 'Pass 10 as the second argument.',
    rejectReason:
      'Inputs are decimal strings and modern engines default to base 10; no wrong case can be shown.',
    match: ({ text }) => /\bparseInt\(\s*[^,()]+\)/.test(text),
  },
  {
    id: 'non-null-find',
    category: 'bug',
    severity: 'minor',
    confidence: 0.58,
    title: 'Non-null assertion on a lookup',
    explanation: 'The result of a lookup is asserted non-null; when nothing matches, the next line throws.',
    suggestion: 'Handle the missing case explicitly (404 or a default).',
    rejectReason: 'The id comes from a list loaded in the same request, so the lookup always matches.',
    match: ({ text }) => /\.find\([^)]*\)!\./.test(text),
  },
];

const TEST_PATH = /(^|\/)(__tests__|tests?|e2e)(\/|$)|\.(test|spec)\.[a-z]+$/i;
const SOURCE_PATH = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function addedLinesOf(file: ChangedFile): AddedLine[] {
  const out: AddedLine[] = [];
  for (const hunk of parsePatch(file.patch)) {
    const window: string[] = [];
    for (const l of hunk.lines) {
      if (l.type === 'del') continue;
      if (l.type === 'add') out.push({ line: l.newLine, text: l.content, before: [...window] });
      window.push(l.content);
      if (window.length > 8) window.shift();
    }
  }
  return out;
}

function missingTestFinding(file: ChangedFile, files: readonly ChangedFile[]): Finding | null {
  if (!SOURCE_PATH.test(file.path) || TEST_PATH.test(file.path)) return null;
  if (files.some((f) => TEST_PATH.test(f.path))) return null;
  const added = addedLinesOf(file);
  const exported = added.find((a) =>
    /^export (async )?function \w+|^export const \w+ = (async )?\(/.test(a.text.trim()),
  );
  if (!exported || added.length < 12) return null;
  const name = /(?:function|const) (\w+)/.exec(exported.text)?.[1] ?? 'this function';
  return {
    category: 'missing-test',
    severity: 'minor',
    file: file.path,
    lineStart: exported.line,
    lineEnd: exported.line,
    title: `No test for ${name}`,
    explanation: `\`${name}\` adds new branching logic and no test in this PR covers it.`,
    suggestion: `Add a unit test covering the main case and one edge case of \`${name}\`.`,
    confidence: 0.7,
  };
}

const RULE_BY_TITLE = new Map(RULES.map((r) => [r.title, r]));
const SYSTEM_PROMPT_TOKENS = 2_400;
/** The task block after the cached context (instructions for this pass). */
const TASK_TOKENS = 150;

function contextTokens(ctx: EngineContext): number {
  const chars =
    ctx.pr.title.length +
    ctx.pr.body.length +
    ctx.settings.instructions.length +
    ctx.files.reduce((n, f) => n + (f.patch?.length ?? 0) + (f.newContent?.length ?? 0), 0) +
    ctx.related.reduce((n, r) => n + r.content.length, 0);
  return Math.ceil(chars / 4) + 400;
}

export const fakeEngine: ReviewEngine = {
  kind: 'fake',

  async find(ctx: EngineContext): Promise<FindResult> {
    const findings: Finding[] = [];
    for (const file of ctx.files) {
      const seen = new Set<string>();
      for (const added of addedLinesOf(file)) {
        for (const rule of RULES) {
          if (seen.has(rule.id) || !rule.match(added, file)) continue;
          seen.add(rule.id);
          findings.push({
            category: rule.category,
            severity: rule.severity,
            file: file.path,
            lineStart: added.line,
            lineEnd: added.line,
            title: rule.title,
            explanation: rule.explanation,
            suggestion: rule.suggestion,
            confidence: rule.confidence,
            ...(rule.fix ? { replacement: rule.fix(added.text) } : {}),
          });
        }
      }
      const missing = missingTestFinding(file, ctx.files);
      if (missing) findings.push(missing);
    }
    findings.sort((a, b) => b.confidence - a.confidence);
    const kept = findings.slice(0, 10);
    // Like the Claude engine: pass 1 writes the review context to the cache;
    // only the short task block after the cache breakpoint is plain input.
    const usage: CallUsage = {
      inputTokens: TASK_TOKENS,
      outputTokens: 160 + 150 * kept.length,
      cacheReadTokens: SYSTEM_PROMPT_TOKENS,
      cacheWriteTokens: contextTokens(ctx),
    };
    return { findings: kept, usage };
  },

  async verify(ctx: EngineContext, findings: Finding[]): Promise<VerifyResult> {
    const verifications: Verification[] = findings.map((f, index) => {
      const rule = RULE_BY_TITLE.get(f.title);
      if (rule?.rejectReason) return { index, outcome: 'rejected', reason: rule.rejectReason };
      if (f.confidence < 0.6)
        return { index, outcome: 'rejected', reason: 'Speculative: no concrete failing case.' };
      return {
        index,
        outcome: 'confirmed',
        reason: 'The changed line shows the problem directly.',
        ...(f.replacement !== undefined ? { replacementSafe: true } : {}),
      };
    });
    // Pass 2 reads the cached context back and sends the findings to check.
    const usage: CallUsage = {
      inputTokens: TASK_TOKENS + 120 * findings.length,
      outputTokens: 80 + 60 * findings.length,
      cacheReadTokens: SYSTEM_PROMPT_TOKENS + contextTokens(ctx),
      cacheWriteTokens: 0,
    };
    return { verifications, usage };
  },
};
