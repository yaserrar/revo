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
