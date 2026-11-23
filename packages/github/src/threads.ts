import type { FeedbackOutcome } from '@revo/shared';
import type { GithubClient, RepoRef } from './client';

/** A reaction GitHub can show on a comment (GraphQL `ReactionContent`). */
export type ReactionContent =
  'THUMBS_UP' | 'THUMBS_DOWN' | 'LAUGH' | 'HOORAY' | 'CONFUSED' | 'HEART' | 'ROCKET' | 'EYES';

/** A review thread of the PR as Revo needs it: resolved or not, its first comment and that comment's reactions. */
export type ReviewThreadState = {
  /** GraphQL node id (for resolveReviewThread). */
  threadId: string;
  isResolved: boolean;
  /** REST id of the thread's first comment: Revo's inline comment when Revo opened the thread. */
  commentId: number;
  /** One entry per person and reaction; bots and organisations are left out. */
  reactions: { content: ReactionContent; userId: number; login: string }[];
};

/** Threads read per page, and reactors per reaction (a 👍 from more than 50 people is still a 👍). */
const THREADS_PER_PAGE = 50;
const REACTORS_PER_GROUP = 50;
/** Pages read at most: 500 threads on one PR is far beyond any real review. */
const MAX_PAGES = 10;

const THREADS_QUERY = `
query RevoReviewThreads($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: ${THREADS_PER_PAGE}, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          comments(first: 1) {
            nodes {
              databaseId
              reactionGroups {
                content
                reactors(first: ${REACTORS_PER_GROUP}) {
                  nodes { __typename ... on User { login databaseId } }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

type ThreadsResponse = {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: ({
          id: string;
          isResolved: boolean;
          comments: {
            nodes: ({
              databaseId: number | null;
              reactionGroups:
                | {
                    content: ReactionContent;
                    reactors: {
                      nodes: ({ __typename: string; login?: string; databaseId?: number | null } | null)[];
                    };
                  }[]
                | null;
            } | null)[];
          };
        } | null)[];
      };
    } | null;
  } | null;
};

/**
 * Every review thread of a PR with its resolved state and the reactions on
 * its first comment, in one GraphQL query per 50 threads. Reactions have no
 * webhook, so Revo reads them when it needs them.
 */
export async function listReviewThreads(
  octokit: GithubClient,
  ref: RepoRef,
  number: number,
): Promise<ReviewThreadState[]> {
  const threads: ReviewThreadState[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: ThreadsResponse = await octokit.graphql<ThreadsResponse>(THREADS_QUERY, {
      owner: ref.owner,
      repo: ref.repo,
      number,
      after,
    });
    const connection = data.repository?.pullRequest?.reviewThreads;
    if (!connection) break;
    for (const node of connection.nodes) {
      const first = node?.comments.nodes[0];
      if (!node || !first || typeof first.databaseId !== 'number') continue;
      const reactions: ReviewThreadState['reactions'] = [];
      for (const group of first.reactionGroups ?? []) {
        for (const actor of group.reactors.nodes) {
          if (actor?.__typename !== 'User' || typeof actor.databaseId !== 'number' || !actor.login) continue;
          reactions.push({ content: group.content, userId: actor.databaseId, login: actor.login });
        }
      }
      threads.push({
        threadId: node.id,
        isResolved: node.isResolved,
        commentId: first.databaseId,
        reactions,
      });
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  return threads;
}

/** Resolves a review thread (Revo does it when a later push fixed the finding it opened). */
export async function resolveReviewThread(octokit: GithubClient, threadId: string): Promise<void> {
  await octokit.graphql(
    `mutation RevoResolveThread($threadId: ID!) {
      resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } }
    }`,
    { threadId },
  );
}

/** 👍 means the finding was useful, 👎 that it was wrong; other reactions say nothing about it. */
const REACTION_OUTCOME: Partial<Record<ReactionContent, FeedbackOutcome>> = {
  THUMBS_UP: 'useful',
  THUMBS_DOWN: 'wrong',
};

export type ReactionFeedback = { userId: number; login: string; outcome: FeedbackOutcome };

/**
 * The feedback a thread's reactions give: one per person. Someone who left
 * both 👍 and 👎 has said nothing clear and is left out.
 */
export function reactionFeedback(thread: Pick<ReviewThreadState, 'reactions'>): ReactionFeedback[] {
  const byUser = new Map<number, ReactionFeedback | null>();
  for (const r of thread.reactions) {
    const outcome = REACTION_OUTCOME[r.content];
    if (!outcome) continue;
    const seen = byUser.get(r.userId);
    if (seen === undefined) byUser.set(r.userId, { userId: r.userId, login: r.login, outcome });
    else if (seen && seen.outcome !== outcome) byUser.set(r.userId, null);
  }
  return [...byUser.values()].filter((f): f is ReactionFeedback => f !== null);
}
