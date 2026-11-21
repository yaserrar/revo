import { filterFiles, selectFiles, type ChangedFile } from '@revo/review';
import { getFileContent, listPullRequestFiles, type GithubClient, type RepoRef } from '@revo/github';

/** Downloads run a few at a time to stay polite with the GitHub API. */
const CONTENT_CONCURRENCY = 5;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

/**
 * The PR's changed files with patches (spec 7.1), plus the full new content
 * of the files that will actually be reviewed (after filtering and size
 * limits, so a huge PR does not download hundreds of files).
 */
export async function fetchChangedFiles(
  octokit: GithubClient,
  ref: RepoRef,
  prNumber: number,
  headSha: string,
  ignoreGlobs: readonly string[],
): Promise<ChangedFile[]> {
  const files: ChangedFile[] = await listPullRequestFiles(octokit, ref, prNumber);
  const selected = selectFiles(filterFiles(files, ignoreGlobs).reviewable).selected;
  const wanted = new Set(selected.filter((f) => f.status !== 'removed').map((f) => f.path));
  const contents = await mapLimit([...wanted], CONTENT_CONCURRENCY, async (path) => ({
    path,
    content: await getFileContent(octokit, ref, path, headSha),
  }));
  const byPath = new Map(contents.map((c) => [c.path, c.content]));
  return files.map((f) => {
    const content = byPath.get(f.path);
    return typeof content === 'string' ? { ...f, newContent: content } : f;
  });
}

/** Reads repo files at the head commit, for related-file context (spec 7.4). */
export function headFileReader(octokit: GithubClient, ref: RepoRef, headSha: string) {
  return (path: string) => getFileContent(octokit, ref, path, headSha);
}
