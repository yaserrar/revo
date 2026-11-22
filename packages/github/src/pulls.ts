import type { GithubClient, RepoRef } from './client';
import { githubErrorStatus } from './client';

/** PR metadata the pipeline needs (spec 7.1). */
export type PullRequestInfo = {
  githubId: number;
  number: number;
  title: string;
  body: string;
  url: string;
  author: string;
  authorType: string;
  authorAvatarUrl: string | null;
  draft: boolean;
  state: 'open' | 'closed';
  merged: boolean;
  baseRef: string;
  headRef: string;
  headSha: string;
  changedFiles: number;
  additions: number;
  deletions: number;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
};

export async function getPullRequest(
  octokit: GithubClient,
  ref: RepoRef,
  number: number,
): Promise<PullRequestInfo> {
  const { data } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    ...ref,
    pull_number: number,
  });
  return {
    githubId: Number(data.id),
    number: data.number,
    title: data.title,
    body: data.body ?? '',
    url: data.html_url,
    author: data.user.login,
    authorType: data.user.type,
    authorAvatarUrl: data.user.avatar_url || null,
    draft: data.draft ?? false,
    state: data.state === 'closed' ? 'closed' : 'open',
    merged: data.merged,
    baseRef: data.base.ref,
    headRef: data.head.ref,
    headSha: data.head.sha,
    changedFiles: data.changed_files,
    additions: data.additions,
    deletions: data.deletions,
    createdAt: data.created_at,
    mergedAt: data.merged_at,
    closedAt: data.closed_at,
  };
}

/** One changed file as GitHub lists it. `patch` is missing for binary or very large diffs. */
export type PullRequestFile = {
  path: string;
  previousPath?: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  patch?: string;
  additions: number;
  deletions: number;
};

/** Every changed file with its patch, across all pages (GitHub caps the list at 3,000 files). */
export async function listPullRequestFiles(
  octokit: GithubClient,
  ref: RepoRef,
  number: number,
): Promise<PullRequestFile[]> {
  const files = await octokit.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
    ...ref,
    pull_number: number,
    per_page: 100,
  });
  return files.map((f) => ({
    path: f.filename,
    ...(f.previous_filename ? { previousPath: f.previous_filename } : {}),
    status: f.status,
    ...(f.patch ? { patch: f.patch } : {}),
    additions: f.additions,
    deletions: f.deletions,
  }));
}

/** Files larger than this are never downloaded for context. */
export const MAX_CONTEXT_FILE_BYTES = 200_000;

/**
 * Text content of a file at a commit, or null when it is missing, a
 * directory, binary, or larger than `maxBytes`.
 */
export async function getFileContent(
  octokit: GithubClient,
  ref: RepoRef,
  path: string,
  commitSha: string,
  maxBytes = MAX_CONTEXT_FILE_BYTES,
): Promise<string | null> {
  try {
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
      ...ref,
      path,
      ref: commitSha,
    });
    if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) return null;
    if (data.size > maxBytes || data.encoding !== 'base64') return null;
    const bytes = Buffer.from(data.content, 'base64');
    // A NUL byte in the first 8 KB means binary, as git decides.
    if (bytes.subarray(0, 8192).includes(0)) return null;
    return bytes.toString('utf8');
  } catch (err) {
    if (githubErrorStatus(err) === 404) return null;
    throw err;
  }
}

/** GitHub lists at most this many files in a comparison. */
const COMPARE_MAX_FILES = 300;

/** A file changed between two commits, with its patch when GitHub gives one. */
export type ComparedFile = { path: string; patch?: string };

/** Commits listed per comparison: more than this and the range is not checked for merges. */
const COMPARE_MAX_COMMITS = 100;

/**
 * Files changed from `baseSha` to `headSha`, when the head is strictly ahead
 * of the base through the author's own commits. Null when the history was
 * rewritten (force-push, rebase), the base commit is gone, a merge commit is
 * in the range (e.g. "Update branch" brought the base branch in: its files
 * are other people's changes), or the comparison is too large to check in
 * full. Callers then treat every file alike.
 */
export async function compareCommits(
  octokit: GithubClient,
  ref: RepoRef,
  baseSha: string,
  headSha: string,
): Promise<ComparedFile[] | null> {
  try {
    // The files of the whole comparison come on the first page, with up to per_page commits.
    const { data } = await octokit.request('GET /repos/{owner}/{repo}/compare/{basehead}', {
      ...ref,
      basehead: `${baseSha}...${headSha}`,
      per_page: COMPARE_MAX_COMMITS,
    });
    const files = data.files ?? [];
    if (data.status !== 'ahead' || files.length >= COMPARE_MAX_FILES) return null;
    if (data.total_commits > data.commits.length) return null;
    if (data.commits.some((c) => c.parents.length > 1)) return null;
    return files.map((f) => ({ path: f.filename, ...(f.patch ? { patch: f.patch } : {}) }));
  } catch (err) {
    const status = githubErrorStatus(err);
    if (status === 404 || status === 422) return null;
    throw err;
  }
}

/** Results asked from one code search: users of a name, not every match. */
const SEARCH_PER_PAGE = 20;

/**
 * Paths of repo files whose text contains `term`, from GitHub code search.
 * It only indexes the default branch, so callers re-check each file at the
 * commit they review. Code search allows about 10 requests a minute: callers
 * keep to a few searches and stop at the first error.
 */
export async function searchCodePaths(octokit: GithubClient, ref: RepoRef, term: string): Promise<string[]> {
  if (!/^[\w$]+$/.test(term)) return [];
  const { data } = await octokit.request('GET /search/code', {
    q: `${term} repo:${ref.owner}/${ref.repo}`,
    per_page: SEARCH_PER_PAGE,
  });
  return [...new Set(data.items.map((item) => item.path))];
}
