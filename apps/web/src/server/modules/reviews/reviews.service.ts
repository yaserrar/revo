import 'server-only';
import { computeScore } from '@revo/review';
import { CategorySchema, DEFAULT_THRESHOLD } from '@revo/shared';
import type { ReviewDetailDto } from '~/types/review';
import { prisma } from '../../config/prisma';
import { notFound } from '../../http/errors';
import { presentFinding } from '../../presenters/finding.presenter';
import { presentReview } from '../../presenters/review.presenter';

const FEEDBACK_INCLUDE = { user: { select: { login: true, avatarUrl: true } } } as const;

export const reviewsService = {
  /** One review with its confirmed and rejected findings, the user's feedback and the breakdown. */
  async detail(id: string, repoIds: string[], userId: string): Promise<ReviewDetailDto> {
    const review = await prisma.review.findUnique({
      where: { id },
      include: {
        repo: { select: { settings: { select: { threshold: true } } } },
        findings: { orderBy: { index: 'asc' }, include: { feedbacks: { include: FEEDBACK_INCLUDE } } },
      },
    });
    if (!review || !repoIds.includes(review.repoId)) throw notFound('Review');

    const previous = await prisma.review.findFirst({
      where: {
        pullRequestId: review.pullRequestId,
        createdAt: { lt: review.createdAt },
        status: 'done',
      },
      orderBy: { createdAt: 'desc' },
      select: { score: true },
    });

    const fixed = await prisma.finding.findMany({
      where: {
        resolution: 'fixed',
        resolvedSha: review.headSha,
        review: { pullRequestId: review.pullRequestId },
      },
      orderBy: [{ severity: 'asc' }, { index: 'asc' }],
      select: {
        id: true,
        reviewId: true,
        category: true,
        severity: true,
        file: true,
        lineStart: true,
        lineEnd: true,
        title: true,
      },
    });

    const findings = review.findings.filter((f) => f.verified);
    const threshold = review.repo.settings?.threshold ?? DEFAULT_THRESHOLD;
    return {
      review: presentReview(review),
      threshold,
      previousScore: previous?.score ?? null,
      breakdown: computeScore(findings, threshold).breakdown,
      findings: findings.map((f) => presentFinding(f, userId)),
      rejected: review.findings.filter((f) => !f.verified).map((f) => presentFinding(f, userId)),
      fixed: fixed.map((f) => ({ ...f, category: CategorySchema.catch('bug').parse(f.category) })),
    };
  },
};
