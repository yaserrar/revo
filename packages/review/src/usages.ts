/**
 * Names a change removes or renames, and the files that still use them.
 *
 * A renamed response field or export breaks its users silently when nothing
 * type-checks across them (a JSON API and its web client, two services). The
 * review is told which names went away and is given the files that still use
 * them: the changed files already in the context, plus files outside the
 * change found by a repo search and re-checked at the PR head.
 *
 * Detection is textual and deliberately narrow, to stay quiet:
 *   - an object or type key (`burnAfterDownload: …`, or shorthand
 *     `unlockedUntil,`) counts only when it is renamed: its deleted line is
 *     replaced, in the same hunk and at the same indentation, by a key with a
 *     new name. Deleting a whole object (a log call, a where clause, a test
 *     fixture) or a parameter list names nothing;
 *   - an exported declaration or a non-private method counts when the new
 *     version no longer declares it (a signature wrapped onto several lines
 *     by a formatter, or an export moved to another reviewed file, is kept);
 *   - never a name declared again on any added line of the same diff;
 *   - compound names only (`camelCase`, `PascalCase`, `snake_case`, at least
 *     5 characters), since short or one-word names (`data`, `status`) match
 *     everywhere.
 */
import { REVIEW_LIMITS } from '@revo/shared';
import { compareFilePriority, createIgnoreMatcher } from './files';
import type { FileReader } from './related';
import type { ChangedFile, RelatedFile, UsageSearch } from './types';

export type NameKind = 'key' | 'export' | 'method';
type Declaration = { name: string; kind: NameKind; indent: number };

const KEY = /^(\s*)(?:readonly\s+)?['"]?([A-Za-z_$][\w$]*)['"]?\??\s*:(?![:=])/;
const SHORTHAND = /^(\s*)([A-Za-z_$][\w$]*)\s*,?\s*$/;
const EXPORTED =
  /^(\s*)export\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;
const MODIFIERS = '(?:(?:public|protected|static|async|override|get|set)\\s+)*';
/** A whole method signature on one line, ending with its opening brace. */
const METHOD = new RegExp(
  `^(\\s+)${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\([^)]*\\)\\s*(?::[^{]*)?\\{\\s*$`,
);
/** The start of a method signature, also when a formatter wraps its parameters. */
const METHOD_START = new RegExp(`^(\\s+)${MODIFIERS}([A-Za-z_$][\\w$]*)\\s*(?:<[^>]*>)?\\(`);
const COMMENT = /^\s*(?:\/\/|\*|\/\*|#)/;

/** Long enough and made of several words, so a text search for it means something. */
export function isDistinctiveName(name: string): boolean {
  return name.length >= 5 && (/[a-z][A-Z]/.test(name) || /[A-Za-z]_[A-Za-z]/.test(name));
}

/**
 * Declarations on lines of code. `loose` (for what the change keeps) also
 * counts wrapped method signatures.
 */
function declarations(lines: readonly string[], loose = false): Declaration[] {
  const out: Declaration[] = [];
  for (const line of lines) {
    if (COMMENT.test(line)) continue;
    const isPrivate = /^\s*private\s/.test(line);
    const patterns: [RegExp, NameKind][] = [
      [EXPORTED, 'export'],
      [KEY, 'key'],
      [SHORTHAND, 'key'],
      ...(isPrivate ? [] : ([[loose ? METHOD_START : METHOD, 'method']] as [RegExp, NameKind][])),
    ];
    for (const [re, kind] of patterns) {
      const m = re.exec(line);
      const name = m?.[2];
      if (!m || !name || !isDistinctiveName(name)) continue;
      out.push({ name, kind, indent: m[1]!.length });
      break;
    }
  }
  return out;
}

type Hunk = { removed: string[]; added: string[] };

function hunksOf(patch: string): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      current = { removed: [], added: [] };
      hunks.push(current);
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      continue;
    } else if (current && line.startsWith('-')) current.removed.push(line.slice(1));
    else if (current && line.startsWith('+')) current.added.push(line.slice(1));
  }
  return hunks;
}

export type RemovedName = { name: string; kind: NameKind };

/**
 * Names a unified diff removes or renames (see the module comment).
 * `stillDeclared` holds names the new code declares elsewhere (the new
 * version of this file, other reviewed files): those are never removed.
 */
export function removedDeclarations(
  patch: string | undefined,
  stillDeclared: ReadonlySet<string> = new Set(),
): RemovedName[] {
  if (!patch) return [];
  const hunks = hunksOf(patch);
  const kept = new Set(hunks.flatMap((h) => declarations(h.added, true).map((d) => d.name)));
  const out = new Map<string, NameKind>();
  for (const hunk of hunks) {
    const removed = declarations(hunk.removed);
    const removedHere = new Set(removed.map((d) => d.name));
    const added = declarations(hunk.added, true);
    for (const d of removed) {
      if (out.has(d.name) || kept.has(d.name)) continue;
      if (d.kind === 'key') {
        const renamed = added.some(
          (a) => a.kind === 'key' && a.indent === d.indent && !removedHere.has(a.name),
        );
        if (!renamed) continue;
      } else if (stillDeclared.has(d.name)) continue;
      out.set(d.name, d.kind);
    }
  }
  return [...out].map(([name, kind]) => ({ name, kind }));
}

/** Names only, for callers that do not need the kind. */
export function removedNames(patch: string | undefined, stillDeclared?: ReadonlySet<string>): string[] {
  return removedDeclarations(patch, stillDeclared).map((d) => d.name);
}

/** Exports and methods the given source still declares (wrapped signatures included). */
export function declaredIn(source: string): Set<string> {
  return new Set(
    declarations(source.split('\n'), true)
      .filter((d) => d.kind !== 'key')
      .map((d) => d.name),
  );
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `text` contains `name` as a whole identifier. */
export function mentions(text: string, name: string): boolean {
  return new RegExp(`(?<![\\w$])${escapeRegExp(name)}(?![\\w$])`).test(text);
}

/**
 * True when `text` uses `name` the way its kind is used: a key as a property
 * (`x.name`, `name: …`, `{ name }`, `'name'`), an export or method anywhere.
 */
export function usesName(text: string, name: string, kind: NameKind): boolean {
  if (kind !== 'key') return mentions(text, name);
  const n = escapeRegExp(name);
  return new RegExp(
    [
      `\\??\\.${n}(?![\\w$])`,
      `(?<![\\w$.])${n}\\??\\s*:(?![:=])`,
      `['"\`]${n}['"\`]`,
      `[{,]\\s*${n}\\s*(?=[,}=])`,
      `^\\s*${n}\\s*,?\\s*$`,
    ].join('|'),
    'm',
  ).test(text);
}

/** Text of a changed file to search: the new version, or the added and context lines of its patch. */
function textOf(file: ChangedFile): string {
  if (file.newContent !== undefined) return file.newContent;
  return (file.patch ?? '')
    .split('\n')
    .filter((l) => l.startsWith('+') || l.startsWith(' '))
    .map((l) => l.slice(1))
    .join('\n');
}

export type NameUsage = {
  name: string;
  kind: NameKind;
  /** The changed file whose diff removes it. */
  removedIn: string;
  /** Other files in the context (changed or related) that still use it. */
  usedIn: string[];
};

export type UsageResult = {
  usages: NameUsage[];
  /** Files outside the change that use a removed name, to add to the related files. */
  extra: RelatedFile[];
};

export type CollectUsagesOptions = {
  /** Changed files in the review (after filtering and size limits). */
  files: readonly ChangedFile[];
  /** Every path the PR changes, reviewed or not: never added as related context. */
  changedPaths?: ReadonlySet<string>;
  /** Related files already in the context (imports, Prisma schema). */
  related: readonly RelatedFile[];
  readFile?: FileReader;
  search?: UsageSearch;
  ignoreGlobs?: readonly string[];
  maxNames?: number;
  maxSearches?: number;
  maxFiles?: number;
};

/** Names listed in the context at most (searched or not). */
const MAX_NAMES = 10;

/**
 * Finds the names the reviewed changes remove (in the PR's diff, or in the
 * diff of the commits since the last review) and where they are still used.
 * Never throws: a failed search (rate limit, network) only ends the search.
 */
export async function collectNameUsages({
  files,
  changedPaths,
  related,
  readFile,
  search,
  ignoreGlobs = [],
  maxNames = MAX_NAMES,
  maxSearches = REVIEW_LIMITS.maxUsageSearches,
  maxFiles = REVIEW_LIMITS.maxUsageFiles,
}: CollectUsagesOptions): Promise<UsageResult> {
  const ordered = [...files].sort(compareFilePriority);
  // Exports and methods the reviewed code still declares: moved or re-wrapped, not removed.
  const stillDeclared = new Set(ordered.flatMap((f) => [...declaredIn(textOf(f))]));
  const removed = new Map<string, { kind: NameKind; removedIn: string }>();
  for (const file of ordered) {
    const found = [
      ...removedDeclarations(file.sinceLastReview?.patch, stillDeclared),
      ...removedDeclarations(file.patch, stillDeclared),
    ];
    for (const { name, kind } of found) {
      if (removed.size >= maxNames) break;
      if (!removed.has(name)) removed.set(name, { kind, removedIn: file.path });
    }
  }
  if (removed.size === 0) return { usages: [], extra: [] };

  const inContext = [
    ...ordered.map((f) => ({ path: f.path, text: textOf(f) })),
    ...related.map((r) => ({ path: r.path, text: r.content })),
  ];
  const taken = new Set([...inContext.map((c) => c.path), ...(changedPaths ?? [])]);
  const isIgnored = createIgnoreMatcher(ignoreGlobs);
  const extra: RelatedFile[] = [];
  let searches = 0;
  let searching = Boolean(search && readFile);

  const usages: NameUsage[] = [];
  for (const [name, { kind, removedIn }] of removed) {
    const usedIn = inContext
      .filter((c) => c.path !== removedIn && usesName(c.text, name, kind))
      .map((c) => c.path);

    if (searching && searches < maxSearches && extra.length < maxFiles) {
      searches++;
      try {
        for (const path of await search!(name)) {
          if (extra.length >= maxFiles) break;
          if (taken.has(path) || isIgnored(path)) continue;
          const content = await readFile!(path);
          // The search may index another branch: only the head version counts.
          if (content === null || !usesName(content, name, kind)) continue;
          taken.add(path);
          inContext.push({ path, text: content });
          extra.push({
            path,
            content,
            reason: `still uses \`${name}\`, which this change removes or renames in ${removedIn}`,
          });
          usedIn.push(path);
        }
      } catch {
        searching = false;
      }
    }
    if (usedIn.length > 0) usages.push({ name, kind, removedIn, usedIn });
  }
  return { usages, extra };
}
