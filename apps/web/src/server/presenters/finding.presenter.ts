import 'server-only';
import type { Feedback, Finding, User } from '@revo/db';
import { CategorySchema, type FeedbackDto, type FeedbackOutcome, type FindingDto } from '@revo/shared';

export type FeedbackRow = Feedback & { user: Pick<User, 'login' | 'avatarUrl'> | null };

/** A dashboard user's row, or a GitHub reactor's (no Revo account needed). */
export function presentFeedback(f: FeedbackRow): FeedbackDto {
  const user = f.user
    ? { login: f.user.login, avatarUrl: f.user.avatarUrl }
    : {
        login: f.githubLogin ?? 'GitHub',
        avatarUrl:
          f.githubUserId !== null ? `https://avatars.githubusercontent.com/u/${f.githubUserId}?v=4` : null,
      };
  return {
    id: f.id,
    outcome: f.outcome,
    source: f.source,
    note: f.note,
    user,
    createdAt: f.createdAt.toISOString(),
  };
}

export function feedbackCounts(rows: readonly Pick<Feedback, 'outcome'>[]): Record<FeedbackOutcome, number> {
  const counts: Record<FeedbackOutcome, number> = { useful: 0, wrong: 0 };
  for (const r of rows) counts[r.outcome]++;
  return counts;
}

export function feedbackFrom(rows: readonly Pick<Feedback, 'source'>[]): FindingDto['feedbackFrom'] {
  return {
    github: rows.filter((r) => r.source === 'github').length,
    fixed: rows.filter((r) => r.source === 'fixed').length,
  };
}

/** A finding with every user's feedback loaded; `userId` picks "my" feedback. */
export function presentFinding(f: Finding & { feedbacks: FeedbackRow[] }, userId: string): FindingDto {
  const mine = f.feedbacks.find((x) => x.userId === userId);
  return {
    id: f.id,
    reviewId: f.reviewId,
    index: f.index,
    category: CategorySchema.catch('bug').parse(f.category),
    severity: f.severity,
    originalSeverity: f.originalSeverity,
    file: f.file,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    title: f.title,
    explanation: f.explanation,
    suggestion: f.suggestion,
    snippet: f.snippet,
    snippetStartLine: f.snippetStartLine,
    confidence: f.confidence,
    verified: f.verified,
    rejectReason: f.rejectReason,
    posted: f.posted,
    myFeedback: mine ? presentFeedback(mine) : null,
    feedbackCounts: feedbackCounts(f.feedbacks),
    feedbackFrom: feedbackFrom(f.feedbacks),
    replacement: f.replacement,
    openSince: f.openSince,
    resolution: f.resolution,
    resolvedSha: f.resolvedSha,
  };
}
