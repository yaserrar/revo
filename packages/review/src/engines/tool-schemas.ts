/**
 * The two report tools the model answers through (spec 7.5: "a tool with a
 * strict JSON schema"). The model-facing schemas are lenient on lengths and
 * ranges (strict tool schemas cannot express them); answers are normalised
 * (trimmed, clamped, cut to the spec's limits) and then validated with the
 * shared Zod schemas. Field order matters: explanations and reasons come
 * before the severity, confidence and outcome they justify.
 */
import { transformJSONSchema } from '@anthropic-ai/sdk/lib/transform-json-schema';
import { z } from 'zod';
import {
  CategorySchema,
  FindingSchema,
  REPLACEMENT_MAX_CHARS,
  REVIEW_LIMITS,
  SeveritySchema,
  VERIFICATION_OUTCOMES,
  VerificationSchema,
  type Finding,
  type Verification,
} from '@revo/shared';
import type Anthropic from '@anthropic-ai/sdk';

export const FINDINGS_TOOL_NAME = 'report_findings';
export const VERIFICATIONS_TOOL_NAME = 'report_verifications';

const ModelFindingSchema = z.object({
  file: z.string().describe('Path of the changed file, exactly as in the context.'),
  lineStart: z.number().int().describe('First line of the problem, in the NEW file.'),
  lineEnd: z
    .number()
    .int()
    .describe('Last line of the problem, in the NEW file (same as lineStart for one line).'),
  category: CategorySchema,
  title: z.string().describe('Names the defect plainly, under 100 characters.'),
  explanation: z
    .string()
    .describe(
      'What is wrong, the concrete scenario that triggers it and its consequence. Under 800 characters.',
    ),
  suggestion: z
    .string()
    .describe('How to fix it, with a short code example when it helps. Under 800 characters.'),
  replacement: z
    .string()
    .nullable()
    .describe(
      'The exact new code for lines lineStart..lineEnd (all of them, with their indentation), when the fix is a local edit of those lines; null otherwise.',
    ),
  severity: SeveritySchema,
  confidence: z.number().describe('0 to 1: how sure you are this is a real defect.'),
});

const ModelFindingsSchema = z.object({
  findings: z
    .array(ModelFindingSchema)
    .describe('At most 10 findings, most important first. Empty when nothing meets the bar.'),
});

const ModelVerificationSchema = z.object({
  index: z.number().int().describe('Index of the finding from pass 1.'),
  reason: z.string().describe('Why, naming the line or code that decides it. Under 400 characters.'),
  outcome: z.enum(VERIFICATION_OUTCOMES),
  severity: SeveritySchema.nullable().describe(
    'A LOWER severity when a confirmed finding is overstated; null to keep it.',
  ),
  replacementSafe: z
    .boolean()
    .nullable()
    .describe(
      'For a finding with a replacement: true only if applying it exactly fixes the problem and breaks nothing; null when there is none.',
    ),
});

const ModelVerificationsSchema = z.object({
  verifications: z.array(ModelVerificationSchema).describe('Exactly one answer per finding index.'),
});

/**
 * What the parsers accept: the tool schemas above, with the one-click fix
 * fields optional (an answer without them simply has no one-click fix).
 */
const ParsedFindingsSchema = z.object({
  findings: z.array(ModelFindingSchema.partial({ replacement: true })),
});
const ParsedVerificationsSchema = z.object({
  verifications: z.array(ModelVerificationSchema.partial({ replacementSafe: true })),
});

/** Drops the safe-integer bounds Zod adds to every `.int()`: they say nothing to the model. */
function withoutIntBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withoutIntBounds);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    const bound =
      (key === 'minimum' || key === 'maximum') && Math.abs(Number(value)) === Number.MAX_SAFE_INTEGER;
    if (!bound) out[key] = withoutIntBounds(value);
  }
  return out;
}

function toolSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const json = withoutIntBounds(z.toJSONSchema(schema)) as Record<string, unknown>;
  return transformJSONSchema(json) as Anthropic.Beta.BetaTool.InputSchema;
}

/** JSON schemas of the two report tools' input (also the subscription engine's structured output). */
export const REPORT_INPUT_SCHEMAS = {
  [FINDINGS_TOOL_NAME]: toolSchema(ModelFindingsSchema),
  [VERIFICATIONS_TOOL_NAME]: toolSchema(ModelVerificationsSchema),
} as const;

/** Both tools go in both passes: an identical tool list keeps the prompt cache shared. */
export const REPORT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: FINDINGS_TOOL_NAME,
    description:
      'Pass 1 only. Report the real problems found in the change, most important first. Call once; an empty list means the change is clean.',
    strict: true,
    input_schema: REPORT_INPUT_SCHEMAS[FINDINGS_TOOL_NAME],
  },
  {
    name: VERIFICATIONS_TOOL_NAME,
    description:
      'Pass 2 only. Confirm or reject each finding from pass 1, with one answer per index. Call once.',
    strict: true,
    input_schema: REPORT_INPUT_SCHEMAS[VERIFICATIONS_TOOL_NAME],
  },
];

export type ParseResult<T> = { ok: true; value: T } | { ok: false; problem: string };

const cut = (text: string, max: number) => {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

const issues = (error: z.ZodError) =>
  error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join('.') || 'input'}: ${i.message}`)
    .join('; ');

/**
 * A replacement is kept only when it fits (never cut: half a fix is worse than
 * none). Line endings are normalised and one final newline is dropped, since
 * it replaces whole lines.
 */
function replacementField(value: string | null | undefined): { replacement?: string } {
  if (typeof value !== 'string') return {};
  const code = value.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return code.length <= REPLACEMENT_MAX_CHARS ? { replacement: code } : {};
}

/** Normalises and validates pass 1's tool input. */
export function parseFindingsInput(input: unknown): ParseResult<Finding[]> {
  const raw = ParsedFindingsSchema.safeParse(input);
  if (!raw.success)
    return { ok: false, problem: `the input does not match the schema (${issues(raw.error)})` };
  const findings: Finding[] = [];
  for (const [i, f] of raw.data.findings.slice(0, REVIEW_LIMITS.maxFindingsPass1).entries()) {
    const start = Math.max(1, Math.min(f.lineStart, f.lineEnd));
    const candidate = {
      category: f.category,
      severity: f.severity,
      file: f.file.trim().replace(/^\.?\//, ''),
      lineStart: start,
      lineEnd: Math.max(start, f.lineStart, f.lineEnd),
      title: cut(f.title, 100),
      explanation: cut(f.explanation, 800),
      suggestion: cut(f.suggestion, 800),
      confidence: Math.min(1, Math.max(0, f.confidence)),
      ...replacementField(f.replacement),
    };
    const parsed = FindingSchema.safeParse(candidate);
    if (!parsed.success) return { ok: false, problem: `finding ${i} is invalid (${issues(parsed.error)})` };
    findings.push(parsed.data);
  }
  return { ok: true, value: findings };
}

/** Normalises and validates pass 2's tool input: one answer per finding index. */
export function parseVerificationsInput(input: unknown, findingCount: number): ParseResult<Verification[]> {
  const raw = ParsedVerificationsSchema.safeParse(input);
  if (!raw.success)
    return { ok: false, problem: `the input does not match the schema (${issues(raw.error)})` };
  const byIndex = new Map<number, Verification>();
  for (const v of raw.data.verifications) {
    if (v.index < 0 || v.index >= findingCount || byIndex.has(v.index)) continue;
    const parsed = VerificationSchema.safeParse({
      index: v.index,
      outcome: v.outcome,
      reason: cut(v.reason, 400),
      ...(v.severity ? { severity: v.severity } : {}),
      ...(typeof v.replacementSafe === 'boolean' ? { replacementSafe: v.replacementSafe } : {}),
    });
    if (!parsed.success)
      return { ok: false, problem: `answer ${v.index} is invalid (${issues(parsed.error)})` };
    byIndex.set(v.index, parsed.data);
  }
  const missing = Array.from({ length: findingCount }, (_, i) => i).filter((i) => !byIndex.has(i));
  if (missing.length > 0) return { ok: false, problem: `there is no answer for index ${missing.join(', ')}` };
  return { ok: true, value: [...byIndex.values()].sort((a, b) => a.index - b.index) };
}
