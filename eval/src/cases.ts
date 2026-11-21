import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { applyPatch, parseGitDiff, type ChangedFile, type FileReader } from '@revo/review';
import { createDirectoryReader } from '@revo/review/node';
import { CategorySchema } from '@revo/shared';

/**
 * One eval case per folder in eval/cases, a pull request against eval/demo-repo:
 *   case.json     { id, title, body, note, expected: [{ file, lineStart, lineEnd, category }] }
 *                 expected = [] for a clean PR; several entries = acceptable locations of one bug
 *   change.patch  `git diff` against the demo repo
 */
export const ExpectedSchema = z.object({
  file: z.string(),
  lineStart: z.number().int(),
  lineEnd: z.number().int(),
  category: CategorySchema,
});
export type Expected = z.infer<typeof ExpectedSchema>;

export const EvalCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string().default(''),
  /** What the bug is (or why the PR is clean), for people reading the results. */
  note: z.string().default(''),
  expected: z.array(ExpectedSchema),
});

export type EvalCase = z.infer<typeof EvalCaseSchema> & {
  files: ChangedFile[];
  /** Reads the demo repo as it is after this PR (for related files). */
  readFile: FileReader;
};

/** Applies a case's patch to the demo repo in memory: new contents for every changed file. */
export function applyCase(
  demoRepo: string,
  files: ChangedFile[],
  caseId: string,
): Map<string, string | null> {
  const overlay = new Map<string, string | null>();
  for (const file of files) {
    if (file.status === 'removed') {
      overlay.set(file.path, null);
      continue;
    }
    const basePath = join(demoRepo, file.previousPath ?? file.path);
    const base = file.status === 'added' || !existsSync(basePath) ? '' : readFileSync(basePath, 'utf8');
    const next = file.patch ? applyPatch(base, file.patch) : base;
    if (next === null)
      throw new Error(`Case ${caseId}: the patch for ${file.path} does not apply to the demo repo`);
    file.newContent = next;
    overlay.set(file.path, next);
  }
  return overlay;
}

export function loadCases(casesDir: string, demoRepo: string): EvalCase[] {
  return readdirSync(casesDir)
    .filter((name) => existsSync(join(casesDir, name, 'case.json')))
    .sort()
    .map((name) => {
      const dir = join(casesDir, name);
      const meta = EvalCaseSchema.parse(JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8')));
      const files = parseGitDiff(readFileSync(join(dir, 'change.patch'), 'utf8'));
      const overlay = applyCase(demoRepo, files, meta.id);
      return { ...meta, files, readFile: createDirectoryReader(demoRepo, overlay) };
    });
}
