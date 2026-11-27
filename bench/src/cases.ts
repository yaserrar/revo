import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { SeveritySchema } from '@revo/shared';

/**
 * One bench case per folder in bench/cases, a change to a real repo (dropwave):
 *   case.json    { id, kind, title, body, base: { sha, patch? }, source, note, expected: [...] }
 *   change.diff  the change Revo reviews (`git show --format= <sha>` or `git diff`)
 *   base.diff    optional: applied on top of base.sha first, when the change's real
 *                parent is not a commit of the repo (e.g. a revert of a planted bug)
 *
 * `expected` lists the bugs the change plants. A clean case has none.
 */
export const LocationSchema = z.object({
  file: z.string().min(1),
  lineStart: z.number().int().min(1),
  lineEnd: z.number().int().min(1),
});
export type Location = z.infer<typeof LocationSchema>;

export const ExpectedSchema = LocationSchema.extend({
  /** Short stable name, e.g. "burn-race". */
  id: z.string().min(1),
  /** How serious the bug is (for reading the results; not used to match). */
  severity: SeveritySchema,
  description: z.string().min(1),
  /** Other places a correct finding may point at (lines on the new side of the diff). */
  alsoAt: z.array(LocationSchema).default([]),
  /** Set when the label needs the owner's confirmation: the open question. */
  confirm: z.string().optional(),
});
export type Expected = z.infer<typeof ExpectedSchema>;

export const CASE_KINDS = ['planted', 'synthetic', 'clean'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const BenchCaseSchema = z
  .object({
    id: z.string().min(1),
    /** planted: a bug the owner planted; synthetic: written for the bench; clean: a real change with no known bug. */
    kind: z.enum(CASE_KINDS),
    title: z.string().min(1),
    body: z.string().default(''),
    base: z.object({ sha: z.string().regex(/^[0-9a-f]{40}$/), patch: z.string().optional() }),
    /** Where the change comes from, for people reading the case. */
    source: z
      .object({
        commit: z.string().optional(),
        parent: z.string().optional(),
        message: z.string().optional(),
        note: z.string().optional(),
      })
      .default({}),
    note: z.string().default(''),
    /** Set when the case's label (e.g. "clean") needs the owner's confirmation. */
    confirm: z.string().optional(),
    expected: z.array(ExpectedSchema),
  })
  .refine((c) => (c.kind === 'clean') === (c.expected.length === 0), {
    message: 'a clean case has no expected bugs, and a planted or synthetic case has at least one',
  });

export type BenchCase = z.infer<typeof BenchCaseSchema> & {
  diff: string;
  /** Absolute path of base.diff, when the case has one. */
  basePatchPath: string | null;
};

/**
 * A finding Revo is known to post wrongly. Matched by file plus any keyword in
 * the title or explanation (lines move between versions of a file; wording does not much).
 */
export const KnownFalsePositiveSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  keywords: z.array(z.string().min(1)).min(1),
  description: z.string(),
  why: z.string(),
});
export type KnownFalsePositive = z.infer<typeof KnownFalsePositiveSchema>;

export function loadCases(casesDir: string): BenchCase[] {
  return readdirSync(casesDir)
    .filter((name) => existsSync(join(casesDir, name, 'case.json')))
    .sort()
    .map((name) => {
      const dir = join(casesDir, name);
      const parsed = BenchCaseSchema.safeParse(JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')));
      if (!parsed.success) throw new Error(`bench/cases/${name}/case.json: ${parsed.error.message}`);
      const meta = parsed.data;
      if (meta.id !== name)
        throw new Error(`bench/cases/${name}: id "${meta.id}" must equal the folder name`);
      const basePatchPath = meta.base.patch ? join(dir, meta.base.patch) : null;
      if (basePatchPath && !existsSync(basePatchPath))
        throw new Error(`bench/cases/${name}: base patch ${meta.base.patch} is missing`);
      return { ...meta, diff: readFileSync(join(dir, 'change.diff'), 'utf8'), basePatchPath };
    });
}

export function loadKnownFalsePositives(path: string): KnownFalsePositive[] {
  if (!existsSync(path)) return [];
  return z.array(KnownFalsePositiveSchema).parse(JSON.parse(readFileSync(path, 'utf8')));
}
