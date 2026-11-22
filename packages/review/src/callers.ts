/**
 * Callers of changed code, outside the change.
 *
 * A change to a function can break code that calls it in a file the PR does
 * not touch: a return value used in an HTTP header, a new exception nobody
 * catches. Revo cannot judge that without seeing the caller (and must not
 * guess), so the review gets up to a few of those files:
 *
 *   1. the functions and methods whose bodies the diff touches, in each
 *      reviewed JS/TS file (the declaration enclosing each changed line);
 *   2. files found by a repo search for the module's file name, re-checked at
 *      the PR head: they must import that module and call one of those
 *      functions;
 *   3. added as related files with a `reason`, never a file the PR changes.
 */
import { parsePatch, REVIEW_LIMITS } from '@revo/shared';
import { compareFilePriority, createIgnoreMatcher } from './files';
import type { FileReader } from './related';
import type { ChangedFile, RelatedFile, UsageSearch } from './types';

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const CONTROL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'constructor']);
const MODIFIERS = '(?:(?:export|default|public|protected|private|static|async|override|get|set)\\s+)*';
const DECLARATIONS = [
  // function name(  ·  export async function name(
  new RegExp(`^\\s*${MODIFIERS}function\\*?\\s+([A-Za-z_$][\\w$]*)\\s*[<(]`),
  // const name = (…) =>  ·  const name = async (…) =>  ·  const name = function
  new RegExp(
    `^\\s*${MODIFIERS}(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=]+)?=\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)?\\s*(?::[^=]*)?=>|[A-Za-z_$][\\w$]*\\s*=>|\\()`,
  ),
  // object or class method, its whole signature on the line:  async name(a: string): T {
  new RegExp(
    `^\\s+${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\((?:[^()]|\\([^()]*\\))*\\)\\s*(?::\\s*[^={;]+)?\\{\\s*$`,
  ),
  // a method whose parameters a formatter wrapped:  async name(
  new RegExp(`^\\s+${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\(\\s*$`),
  // name: async (…) =>
  new RegExp(`^\\s+([A-Za-z_$][\\w$]*)\\s*:\\s*(?:async\\s+)?(?:function\\b|\\([^)]*\\)?\\s*=>)`),
];

/** The function or method declared on a line, if any. */
function declaredFunction(line: string): string | null {
  for (const re of DECLARATIONS) {
    const name = re.exec(line)?.[1];
    if (name && !CONTROL.has(name)) return name;
  }
  return null;
}

/** New-file line numbers the diff adds, or deletes just before. */
function changedLines(patch: string | undefined): number[] {
  const out: number[] = [];
  for (const hunk of parsePatch(patch)) {
    let next = hunk.newStart;
    for (const line of hunk.lines) {
      if (line.type === 'add') {
        out.push(line.newLine);
        next = line.newLine + 1;
      } else if (line.type === 'del') out.push(next);
      else if ('newLine' in line && typeof line.newLine === 'number') next = line.newLine + 1;
    }
  }
  return out;
}

const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlankOrComment = (line: string) => /^\s*(?:$|\/\/|\/\*|\*)/.test(line);

/**
 * Functions and methods of a changed file whose bodies the diff touches: for
 * each changed line of code, every declaration that encloses it in the new
 * version (a nested helper and the method around it). Enclosing means: above
 * it and less indented, the way formatted code nests.
 */
export function changedFunctions(
  file: Pick<ChangedFile, 'patch' | 'newContent' | 'sinceLastReview'>,
): string[] {
  if (file.newContent === undefined) return [];
  const lines = file.newContent.split('\n');
  const declAt: (string | null)[] = lines.map(declaredFunction);
  const names = new Set<string>();
  for (const n of [...changedLines(file.patch), ...changedLines(file.sinceLastReview?.patch)]) {
    const at = Math.min(n, lines.length) - 1;
    if (at < 0 || isBlankOrComment(lines[at]!)) continue;
    if (declAt[at]) names.add(declAt[at]!);
    let indent = indentOf(lines[at]!);
    for (let i = at - 1; i >= 0 && indent > 0; i--) {
      const line = lines[i]!;
      if (line.trim() === '' || indentOf(line) >= indent) continue;
      indent = indentOf(line);
      const name = declAt[i];
      if (name) names.add(name);
    }
  }
  return [...names];
}

/** `src/server/usage/work-usage.service.ts` → `work-usage.service` (null for index files). */
export function moduleName(path: string): string | null {
  const base = path.split('/').pop() ?? '';
  const name = base.replace(SOURCE_FILE, '');
  return name && name !== 'index' && name.length >= 4 ? name : null;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `source` imports a module whose specifier ends with `/<name>` (with or without an extension). */
export function importsModule(source: string, name: string): boolean {
  const spec = `['"][^'"\\n]*\\/${escapeRegExp(name)}(?:\\.[cm]?[jt]sx?)?['"]`;
  return new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\brequire\\s*\\(\\s*)${spec}`).test(source);
}

/** The changed functions `source` calls (`name(` or `.name(`). */
export function callsOf(source: string, names: readonly string[]): string[] {
  return names.filter((n) => new RegExp(`(?<![\\w$])${escapeRegExp(n)}\\s*(?:<[^>()]*>)?\\(`).test(source));
}

export type CollectCallersOptions = {
  /** Changed files in the review (after filtering and size limits). */
  files: readonly ChangedFile[];
  /** Every path the PR changes, and the related files already in the context. */
  taken: ReadonlySet<string>;
  readFile?: FileReader;
  search?: UsageSearch;
  ignoreGlobs?: readonly string[];
  maxSearches?: number;
  maxFiles?: number;
  /** Callers larger than this are skipped (they would crowd out the change itself). */
  maxChars?: number;
};

/**
 * Up to `maxFiles` files outside the change that import a changed module and
 * call a function the change modifies. Never throws: a failed search (rate
 * limit, network) only ends the search.
 */
export async function collectCallers({
  files,
  taken,
  readFile,
  search,
  ignoreGlobs = [],
  maxSearches = REVIEW_LIMITS.maxCallerSearches,
  maxFiles = REVIEW_LIMITS.maxCallerFiles,
  maxChars = 60_000,
}: CollectCallersOptions): Promise<RelatedFile[]> {
  if (!search || !readFile || maxFiles <= 0) return [];
  const isIgnored = createIgnoreMatcher(ignoreGlobs);
  const seen = new Set(taken);
  const out: RelatedFile[] = [];
  let searches = 0;

  for (const file of [...files].sort(compareFilePriority)) {
    if (out.length >= maxFiles || searches >= maxSearches) break;
    if (!SOURCE_FILE.test(file.path) || file.status === 'removed') continue;
    const name = moduleName(file.path);
    const changed = changedFunctions(file);
    if (!name || changed.length === 0) continue;

    searches++;
    let paths: string[];
    try {
      paths = await search(name);
    } catch {
      break;
    }
    for (const path of paths) {
      if (out.length >= maxFiles) break;
      if (seen.has(path) || isIgnored(path) || !SOURCE_FILE.test(path)) continue;
      const content = await readFile(path).catch(() => null);
      if (content === null || content.length > maxChars || !importsModule(content, name)) continue;
      const called = callsOf(content, changed);
      if (called.length === 0) continue;
      seen.add(path);
      out.push({
        path,
        content,
        reason: `calls ${called.map((n) => `\`${n}()\``).join(', ')}, which this change modifies in ${file.path}`,
      });
    }
  }
  return out;
}
