import type { FeedbackBody } from '@revo/shared';
import type { FindingFeedbackDto, ReviewDetailDto } from '~/types/review';
import { api } from './client';

export const reviewsApi = {
  detail: (id: string) => api.get<ReviewDetailDto>(`/reviews/${id}`),
  setFeedback: (findingId: string, body: FeedbackBody) =>
    api.put<FindingFeedbackDto>(`/findings/${findingId}/feedback`, body),
  clearFeedback: (findingId: string) => api.delete<FindingFeedbackDto>(`/findings/${findingId}/feedback`),
};
