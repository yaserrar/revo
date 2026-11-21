import 'server-only';
import type { FeedbackBody } from '@revo/shared';
import type { FindingFeedbackDto } from '~/types/review';
import { prisma } from '../../config/prisma';
import { notFound, unprocessable } from '../../http/errors';
import { feedbackCounts, presentFeedback } from '../../presenters/finding.presenter';

/** The finding, if the user can access its repo (spec 14: feedback only with access). */
async function findAccessibleFinding(findingId: string, repoIds: string[]) {
  const finding = await prisma.finding.findUnique({
    where: { id: findingId },
    select: { id: true, verified: true, review: { select: { repoId: true } } },
  });
  if (!finding || !repoIds.includes(finding.review.repoId)) throw notFound('Finding');
  return finding;
}

async function feedbackState(findingId: string, userId: string): Promise<FindingFeedbackDto> {
  const rows = await prisma.feedback.findMany({
    where: { findingId },
    include: { user: { select: { login: true, avatarUrl: true } } },
  });
  const mine = rows.find((r) => r.userId === userId);
  return { findingId, myFeedback: mine ? presentFeedback(mine) : null, feedbackCounts: feedbackCounts(rows) };
}

export const feedbackService = {
  /** Sets (or changes) the user's "Useful" / "Wrong" on a confirmed finding. */
  async set(findingId: string, repoIds: string[], userId: string, body: FeedbackBody) {
    const finding = await findAccessibleFinding(findingId, repoIds);
    if (!finding.verified) throw unprocessable('Feedback applies to confirmed findings only.');
    const note = body.note ? body.note : null;
    await prisma.feedback.upsert({
      where: { findingId_userId: { findingId, userId } },
      create: { findingId, userId, outcome: body.outcome, note },
      update: { outcome: body.outcome, note },
    });
    return feedbackState(findingId, userId);
  },

  /** Removes the user's feedback (undo). */
  async clear(findingId: string, repoIds: string[], userId: string) {
    await findAccessibleFinding(findingId, repoIds);
    await prisma.feedback.deleteMany({ where: { findingId, userId } });
    return feedbackState(findingId, userId);
  },
};
