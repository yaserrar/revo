import { SUMMARY_MARKER } from '@revo/shared';
import { githubErrorStatus, isAppComment, type AppIdentity, type GithubClient, type RepoRef } from './client';
import { findingKeyFromBody, type InlineTarget } from './inline';

/** Finds the App's summary comment through its hidden marker (comments by anyone else are ignored). */
export async function findSummaryComment(
  octokit: GithubClient,
  ref: RepoRef,
  number: number,
  app: Pick<AppIdentity, 'botLogin'>,
): Promise<number | null> {
  for await (const page of octokit.paginate.iterator(
    'GET /repos/{owner}/{repo}/issues/{issue_number}/comments',
    {
      ...ref,
      issue_number: number,
      per_page: 100,
    },
  )) {
    const found = page.data.find((c) => isAppComment(c, app) && c.body?.includes(SUMMARY_MARKER));
    if (found) return Number(found.id);
  }
  return null;
}

/**
 * Edits the PR's one summary comment, or creates it (spec 7.8: never
 * duplicated). Tries the stored id first, then searches the App's own
 * comments by marker, so a deleted or unknown comment is recovered. A stored
 * id GitHub no longer lets the App edit (404, or 403 for a comment that is not
 * the App's) is dropped. Returns the comment id.
 */
export async function upsertSummaryComment(
  octokit: GithubClient,
  ref: RepoRef,
  number: number,
  body: string,
  knownCommentId: number | null,
  app: Pick<AppIdentity, 'botLogin'>,
): Promise<number> {
  const update = async (commentId: number) => {
    await octokit.request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
      ...ref,
      comment_id: commentId,
      body,
    });
    return commentId;
  };
  if (knownCommentId !== null) {
    try {
      return await update(knownCommentId);
    } catch (err) {
      const status = githubErrorStatus(err);
      if (status !== 404 && status !== 403) throw err;
    }
  }
  const existing = await findSummaryComment(octokit, ref, number, app);
  if (existing !== null) return update(existing);
  const { data } = await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
    ...ref,
    issue_number: number,
    body,
  });
  return Number(data.id);
}

/** Inline comments the App already posted on the PR, by finding key → comment id. */
export async function listPostedFindingComments(
  octokit: GithubClient,
  ref: RepoRef,
  number: number,
  app: Pick<AppIdentity, 'botLogin'>,
): Promise<Map<string, number>> {
  const posted = new Map<string, number>();
  const comments = await octokit.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/comments', {
    ...ref,
    pull_number: number,
    per_page: 100,
  });
  for (const c of comments) {
    if (!isAppComment(c, app)) continue;
    const key = findingKeyFromBody(c.body);
    if (key && !posted.has(key)) posted.set(key, Number(c.id));
  }
  return posted;
}

export type InlineComment = InlineTarget & { path: string; body: string };

/**
 * Posts one PR review (event COMMENT) carrying the inline comments, pinned to
 * the reviewed commit. Returns the created comment ids by finding key.
 */
export async function createInlineReview(
  octokit: GithubClient,
  ref: RepoRef,
  number: number,
  commitSha: string,
  comments: InlineComment[],
): Promise<Map<string, number>> {
  const { data: review } = await octokit.request('POST /repos/{owner}/{repo}/pulls/{pull_number}/reviews', {
    ...ref,
    pull_number: number,
    commit_id: commitSha,
    event: 'COMMENT',
    comments: comments.map((c) => ({
      path: c.path,
      body: c.body,
      line: c.line,
      side: 'RIGHT',
      ...(c.startLine !== undefined ? { start_line: c.startLine, start_side: 'RIGHT' } : {}),
    })),
  });
  // A review carries at most a handful of comments (max findings ≤ 10): one page.
  const { data: created } = await octokit.request(
    'GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews/{review_id}/comments',
    { ...ref, pull_number: number, review_id: Number(review.id), per_page: 100 },
  );
  const byKey = new Map<string, number>();
  for (const c of created) {
    const key = findingKeyFromBody(c.body);
    if (key) byKey.set(key, Number(c.id));
  }
  return byKey;
}
