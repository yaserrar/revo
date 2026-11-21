import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FeedbackBody, FindingDto } from '@revo/shared';
import { qk } from '~/lib/query-keys';
import { reviewsApi } from '~/services/api/reviews';
import type { FindingFeedbackDto, ReviewDetailDto } from '~/types/review';

export const useReview = (id: string | null) =>
  useQuery({
    queryKey: qk.reviews.detail(id ?? ''),
    queryFn: () => reviewsApi.detail(id!),
    enabled: id !== null,
  });

/** `null` clears the feedback (undo). */
export type FeedbackChange = { findingId: string; next: FeedbackBody | null };

function applyFeedback(f: FindingDto, next: FeedbackBody | null, login: string): FindingDto {
  const counts = { ...f.feedbackCounts };
  if (f.myFeedback) counts[f.myFeedback.outcome]--;
  if (next) counts[next.outcome]++;
  return {
    ...f,
    feedbackCounts: counts,
    myFeedback: next
      ? {
          id: f.myFeedback?.id ?? 'pending',
          outcome: next.outcome,
          note: next.note ?? null,
          user: { login, avatarUrl: null },
          createdAt: f.myFeedback?.createdAt ?? new Date().toISOString(),
        }
      : null,
  };
}

function patchFinding(
  data: ReviewDetailDto | undefined,
  findingId: string,
  fn: (f: FindingDto) => FindingDto,
): ReviewDetailDto | undefined {
  if (!data) return data;
  return { ...data, findings: data.findings.map((f) => (f.id === findingId ? fn(f) : f)) };
}

/**
 * "Useful" / "Wrong" with an optional note, optimistic: the card updates at
 * once and rolls back with a toast when the server refuses.
 */
export const useFindingFeedback = (reviewId: string, login: string) => {
  const qc = useQueryClient();
  const key = qk.reviews.detail(reviewId);
  return useMutation({
    mutationFn: ({ findingId, next }: FeedbackChange): Promise<FindingFeedbackDto> =>
      next ? reviewsApi.setFeedback(findingId, next) : reviewsApi.clearFeedback(findingId),
    onMutate: async ({ findingId, next }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<ReviewDetailDto>(key);
      qc.setQueryData<ReviewDetailDto>(key, (d) =>
        patchFinding(d, findingId, (f) => applyFeedback(f, next, login)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSuccess: (result) => {
      qc.setQueryData<ReviewDetailDto>(key, (d) =>
        patchFinding(d, result.findingId, (f) => ({
          ...f,
          myFeedback: result.myFeedback,
          feedbackCounts: result.feedbackCounts,
        })),
      );
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.overview() });
      void qc.invalidateQueries({ queryKey: ['trends'] });
    },
  });
};
