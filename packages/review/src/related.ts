/**
 * Related files for the context (spec 7.4): up to 5 files the changed files
 * import, resolved through relative imports and tsconfig `paths`, plus the
 * Prisma schema when a changed file uses Prisma. Files are read through a
 * callback, so this module has no GitHub or file-system code: the worker
 * passes a GitHub contents reader, the CLI and the eval a local one.
 */
import { REVIEW_LIMITS } from '@revo/shared';
import { compareFilePriority, createIgnoreMatcher } from './files';
import type { ChangedFile, RelatedFile } from './types';

/** Reads a repo file at the PR's head (repo-relative path). Null when it does not exist. */
export type FileReader = (path: string) => Promise<string | null>;

// ── Paths (POSIX, repo-relative, no leading slash) ──────────────────────────

export function dirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

/** Joins and normalises; returns null when the path climbs above the repo root. */
export function joinPath(...parts: string[]): string | null {
  const out: string[] = [];
  for (const segment of parts.join('/').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(segment);
  }
  return out.join('/');
}

// ── Imports ─────────────────────────────────────────────────────────────────

const STATIC_IMPORT = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*${}\s,]+?\s+from\s+)?['"]([^'"\n]+)['"]/g;
const DYNAMIC_IMPORT = /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

/** Module specifiers imported or re-exported by a JS/TS source, in order, without duplicates. */
export function parseImportSpecifiers(source: string): string[] {
  const found: { spec: string; at: number }[] = [];
  for (const re of [STATIC_IMPORT, DYNAMIC_IMPORT]) {
    for (const m of source.matchAll(re)) found.push({ spec: m[1]!, at: m.index });
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((f) => f.spec))];
}

const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

/** Files a module base path may resolve to, in the order TypeScript tries them. */
export function candidateFiles(base: string): string[] {
  const out: string[] = [];
  if (SOURCE_FILE.test(base)) {
    // ESM TypeScript writes `./x.js` for `./x.ts`.
    const stem = base.replace(/\.(?:[cm]?js|jsx)$/, '');
    if (stem !== base) out.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`);
    out.push(base);
  } else if (/\.(?:json|prisma)$/.test(base)) {
    out.push(base);
  } else {
    out.push(...RESOLVE_EXTENSIONS.map((ext) => base + ext));
    out.push(...RESOLVE_EXTENSIONS.map((ext) => `${base}/index${ext}`));
  }
  return [...new Set(out)];
}

// ── tsconfig ────────────────────────────────────────────────────────────────

/** JSON with comments and trailing commas (tsconfig.json). Null when unreadable. */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else out += c;
  }
  try {
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
  } catch {
    return null;
  }
}

/** Resolved `compilerOptions.paths`: patterns and targets relative to the repo root. */
export type TsPaths = { patterns: { key: string; targets: string[] }[] };

type RawTsconfig = { extends?: unknown; compilerOptions?: { baseUrl?: unknown; paths?: unknown } };

/**
 * Loads `paths` from a tsconfig, following relative `extends` (up to 3
 * levels). Targets resolve against `baseUrl`, or the declaring file's folder.
 */
export async function loadTsPaths(
  readFile: FileReader,
  tsconfigPath: string,
  depth = 0,
): Promise<TsPaths | null> {
  const text = await readFile(tsconfigPath);
  if (text === null) return null;
  const raw = parseJsonc(text) as RawTsconfig | null;
  if (!raw || typeof raw !== 'object') return null;
  const dir = dirname(tsconfigPath);
  const options = raw.compilerOptions ?? {};
  const paths = options.paths;
  if (paths && typeof paths === 'object') {
    const base = joinPath(dir, typeof options.baseUrl === 'string' ? options.baseUrl : '.') ?? '';
    return {
      patterns: Object.entries(paths as Record<string, unknown>).map(([key, targets]) => ({
        key,
        targets: (Array.isArray(targets) ? targets : [])
          .filter((t): t is string => typeof t === 'string')
          .map((t) => joinPath(base, t))
          .filter((t): t is string => t !== null),
      })),
    };
  }
  if (depth < 3 && typeof raw.extends === 'string' && raw.extends.startsWith('.')) {
    const parent = joinPath(dir, raw.extends.endsWith('.json') ? raw.extends : `${raw.extends}.json`);
    if (parent !== null) return loadTsPaths(readFile, parent, depth + 1);
  }
  return null;
}

/** Base paths a non-relative specifier maps to through tsconfig `paths` (exact key, then `*`). */
export function matchTsPaths(spec: string, tsPaths: TsPaths | null): string[] {
  if (!tsPaths) return [];
  for (const { key, targets } of tsPaths.patterns) {
    const star = key.indexOf('*');
    if (star === -1) {
      if (key === spec) return targets;
      continue;
    }
    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (spec.startsWith(prefix) && spec.endsWith(suffix) && spec.length >= prefix.length + suffix.length) {
      const middle = spec.slice(prefix.length, spec.length - suffix.length);
      return targets.map((t) => t.replace('*', middle));
    }
  }
  return [];
}

// ── Prisma ──────────────────────────────────────────────────────────────────

const USES_PRISMA =
  /from\s+['"]@prisma\/client['"]|new\s+PrismaClient\b|\bprisma\.\$(?:queryRaw|executeRaw|transaction)|\b(?:prisma|db|tx)\.\w+\.(?:findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\(/;

export function usesPrisma(source: string): boolean {
  return USES_PRISMA.test(source);
}

/** Where a Prisma schema may live, nearest to the changed files first. */
export function prismaSchemaCandidates(changedPaths: readonly string[]): string[] {
  const out: string[] = [];
  for (const path of changedPaths) {
    let dir = dirname(path);
    for (;;) {
      const prefix = dir ? `${dir}/` : '';
      out.push(`${prefix}prisma/schema.prisma`, `${prefix}schema.prisma`);
      if (!dir) break;
      dir = dirname(dir);
    }
  }
  return [...new Set(out)];
}

// ── Collection ──────────────────────────────────────────────────────────────

/** The text of a changed file to scan for imports: the new version, or its added and context lines. */
function sourceOf(file: ChangedFile): string {
  if (file.newContent !== undefined) return file.newContent;
  return (file.patch ?? '')
    .split('\n')
    .filter((l) => l.startsWith('+') || l.startsWith(' '))
    .map((l) => l.slice(1))
    .join('\n');
}

export type CollectRelatedOptions = {
  /** Changed files, after filtering and size limits. */
  files: readonly ChangedFile[];
  readFile: FileReader;
  /** Repo ignore globs: ignored files are never sent as context either. */
  ignoreGlobs?: readonly string[];
  maxFiles?: number;
  /** Cap on reader calls (each may be a GitHub API request). */
  maxReads?: number;
};

/**
 * Up to `maxFiles` related files: the Prisma schema first when a changed file
 * uses Prisma, then imported files ranked by how many changed files import
 * them, then by the importer's priority. Never a changed or ignored file.
 */
export async function collectRelatedFiles({
  files,
  readFile,
  ignoreGlobs = [],
  maxFiles = REVIEW_LIMITS.maxRelatedFiles,
  maxReads = 60,
}: CollectRelatedOptions): Promise<RelatedFile[]> {
  if (maxFiles <= 0 || files.length === 0) return [];
  const changed = new Set(files.map((f) => f.path));
  const isIgnored = createIgnoreMatcher(ignoreGlobs);
  const cache = new Map<string, Promise<string | null>>();
  let reads = 0;
  const read = (path: string): Promise<string | null> => {
    const hit = cache.get(path);
    if (hit) return hit;
    if (reads >= maxReads) return Promise.resolve(null);
    reads++;
    const pending = readFile(path).catch(() => null);
    cache.set(path, pending);
    return pending;
  };

  const ordered = [...files].sort(compareFilePriority);
  const sources = new Map(ordered.map((f) => [f.path, sourceOf(f)]));
  const related: RelatedFile[] = [];
  const taken = new Set<string>();

  if (
    ordered.some((f) => usesPrisma(sources.get(f.path)!)) &&
    ![...changed].some((p) => p.endsWith('.prisma'))
  ) {
    for (const candidate of prismaSchemaCandidates(ordered.map((f) => f.path))) {
      const content = await read(candidate);
      if (content !== null) {
        related.push({ path: candidate, content });
        taken.add(candidate);
        break;
      }
    }
  }

  // Nearest tsconfig.json per folder, looked up once.
  const tsconfigByDir = new Map<string, Promise<TsPaths | null>>();
  const tsPathsFor = (dir: string): Promise<TsPaths | null> => {
    const hit = tsconfigByDir.get(dir);
    if (hit) return hit;
    const pending = (async () => {
      const own = await read(dir ? `${dir}/tsconfig.json` : 'tsconfig.json');
      if (own !== null) return loadTsPaths(read, dir ? `${dir}/tsconfig.json` : 'tsconfig.json');
      return dir ? tsPathsFor(dirname(dir)) : null;
    })();
    tsconfigByDir.set(dir, pending);
    return pending;
  };

  // base path -> how many changed files import it, and the first importer's rank.
  const wanted = new Map<string, { count: number; rank: number; order: number }>();
  let order = 0;
  for (const [rank, file] of ordered.entries()) {
    const seen = new Set<string>();
    for (const spec of parseImportSpecifiers(sources.get(file.path)!)) {
      const bases = spec.startsWith('.')
        ? [joinPath(dirname(file.path), spec)].filter((b): b is string => b !== null)
        : matchTsPaths(spec, await tsPathsFor(dirname(file.path)));
      for (const base of bases) {
        if (seen.has(base)) continue;
        seen.add(base);
        const entry = wanted.get(base);
        if (entry) entry.count++;
        else wanted.set(base, { count: 1, rank, order: order++ });
      }
    }
  }

  const ranked = [...wanted.entries()].sort(
    ([, a], [, b]) => b.count - a.count || a.rank - b.rank || a.order - b.order,
  );
  for (const [base] of ranked) {
    if (related.length >= maxFiles) break;
    for (const candidate of candidateFiles(base)) {
      if (changed.has(candidate)) break;
      if (taken.has(candidate) || isIgnored(candidate)) break;
      const content = await read(candidate);
      if (content === null) continue;
      related.push({ path: candidate, content });
      taken.add(candidate);
      break;
    }
  }
  return related.slice(0, maxFiles);
}
