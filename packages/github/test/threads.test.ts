import { describe, expect, it, vi } from 'vitest';
import type { GithubClient } from '../src/client';
import { listReviewThreads, reactionFeedback } from '../src/threads';

describe('feedback from reactions', () => {
  const r = (content: 'THUMBS_UP' | 'THUMBS_DOWN' | 'HEART', login: string, userId: number) => ({
    content,
    login,
    userId,
  });

  it('reads 👍 as useful and 👎 as wrong, one answer per person', () => {
    expect(
      reactionFeedback({
        reactions: [
          r('THUMBS_UP', 'maya', 1),
          r('THUMBS_DOWN', 'jonas', 2),
          r('HEART', 'sam', 3),
          r('THUMBS_UP', 'eve', 4),
          r('THUMBS_DOWN', 'eve', 4),
        ],
      }),
    ).toEqual([
      { userId: 1, login: 'maya', outcome: 'useful' },
      { userId: 2, login: 'jonas', outcome: 'wrong' },
    ]);
  });
});

describe('listReviewThreads', () => {
  it('pages through the threads, keeps people only, and skips threads without a comment id', async () => {
    const page = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null) => ({
      repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage, endCursor }, nodes } } },
    });
    const thread = (id: string, commentId: number | null, resolved = false) => ({
      id,
      isResolved: resolved,
      comments: {
        nodes: [
          {
            databaseId: commentId,
            reactionGroups: [
              {
                content: 'THUMBS_UP',
                reactors: {
                  nodes: [
                    { __typename: 'User', login: 'maya', databaseId: 1 },
                    { __typename: 'Bot', login: 'dependabot' },
                  ],
                },
              },
            ],
          },
        ],
      },
    });
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page([thread('T1', 11), thread('T0', null)], true, 'c1'))
      .mockResolvedValueOnce(page([thread('T2', 12, true)], false, null));
    const threads = await listReviewThreads(
      { graphql } as unknown as GithubClient,
      { owner: 'a', repo: 'b' },
      7,
    );
    expect(threads).toEqual([
      {
        threadId: 'T1',
        isResolved: false,
        commentId: 11,
        reactions: [{ content: 'THUMBS_UP', userId: 1, login: 'maya' }],
      },
      {
        threadId: 'T2',
        isResolved: true,
        commentId: 12,
        reactions: [{ content: 'THUMBS_UP', userId: 1, login: 'maya' }],
      },
    ]);
    expect(graphql.mock.calls[1]![1]).toMatchObject({ owner: 'a', repo: 'b', number: 7, after: 'c1' });
  });
});
