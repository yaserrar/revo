/**
 * The repo under review, cloned once into the work folder. For each case the
 * clone is reset to the case's base commit, the optional base patch and then
 * the change are applied with `git apply`, so the working tree is exactly the
 * PR head: Revo reads related files from it and `git grep`s it for the users
 * of renamed names, like `pnpm review:local --repo`.
 *
 * The source repo is only ever cloned from (read-only).
 */
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseGitDiff, type ChangedFile, type FileReader, type UsageSearch } from '@revo/review';
import { createDirectoryReader } from '@revo/review/node';

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...(input !== undefined ? { input } : {}),
  });
}

/** Clones `source` (a path or URL) into `workDir/<name>` unless a clone is already there. */
export function ensureClone(source: string, workDir: string, name: string): string {
  const dir = resolve(workDir, name);
  if (existsSync(join(dir, '.git'))) return dir;
  mkdirSync(workDir, { recursive: true });
  // --no-hardlinks: the clone shares no object files with the source repo.
  execFileSync('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', source, dir], {
    stdio: 'inherit',
  });
  return dir;
}

/** The case's repo state could not be built (missing commit, patch that does not apply). */
export class CaseSetupError extends Error {
  override name = 'CaseSetupError';
}

export type PreparedChange = {
  files: ChangedFile[];
  readFile: FileReader;
  searchUsages: UsageSearch;
};

/**
 * Resets the clone to `baseSha`, applies `basePatchPath` (if any) and the
 * change, and returns the changed files with their new contents.
 */
export function prepareChange(
  clone: string,
  baseSha: string,
  basePatchPath: string | null,
  diff: string,
): PreparedChange {
  try {
    git(clone, ['cat-file', '-e', `${baseSha}^{commit}`]);
  } catch {
    throw new CaseSetupError(
      `commit ${baseSha.slice(0, 7)} is not in the clone at ${clone}: delete the clone to re-create it, ` +
        'or check that the source repo still has this commit',
    );
  }
  git(clone, ['checkout', '--quiet', '--force', '--detach', baseSha]);
  git(clone, ['clean', '--quiet', '-fd']);
  const apply = (patch: string, what: string) => {
    try {
      git(clone, ['apply', '--whitespace=nowarn', '-'], patch);
    } catch (err) {
      const detail = (err as { stderr?: string }).stderr?.trim().split('\n')[0] ?? String(err);
      throw new CaseSetupError(`${what} does not apply on ${baseSha.slice(0, 7)}: ${detail}`);
    }
  };
  if (basePatchPath) apply(readFileSync(basePatchPath, 'utf8'), 'base.diff');
  apply(diff, 'change.diff');

  const files = parseGitDiff(diff);
  const overlay = new Map<string, string | null>();
  for (const file of files) {
    if (file.status === 'removed') {
      overlay.set(file.path, null);
      continue;
    }
    const onDisk = join(clone, file.path);
    if (existsSync(onDisk)) {
      file.newContent = readFileSync(onDisk, 'utf8');
      overlay.set(file.path, file.newContent);
    }
  }
  return { files, readFile: createDirectoryReader(clone, overlay), searchUsages: gitGrep(clone) };
}

/** Files of the clone that contain `name` as a word (same search as `pnpm review:local --repo`). */
function gitGrep(dir: string): UsageSearch {
  return (name: string) =>
    new Promise<string[]>((done) => {
      execFile('git', ['-C', dir, 'grep', '-l', '-w', '-F', '-e', name], (err, stdout) => {
        done(err ? [] : stdout.split('\n').filter(Boolean).slice(0, 20));
      });
    });
}
