-- CreateEnum
CREATE TYPE "FeedbackSource" AS ENUM ('dashboard', 'github', 'fixed');

-- CreateEnum
CREATE TYPE "FindingResolution" AS ENUM ('fixed', 'dismissed');

-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "githubLogin" TEXT,
ADD COLUMN     "githubUserId" BIGINT,
ADD COLUMN     "source" "FeedbackSource" NOT NULL DEFAULT 'dashboard',
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Finding" ADD COLUMN     "openSince" TEXT,
ADD COLUMN     "replacement" TEXT,
ADD COLUMN     "resolution" "FindingResolution",
ADD COLUMN     "resolvedAt" TIMESTAMP(3),
ADD COLUMN     "resolvedSha" TEXT;

-- AlterTable
ALTER TABLE "PullRequest" ADD COLUMN     "feedbackSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_findingId_githubUserId_key" ON "Feedback"("findingId", "githubUserId");

-- CreateIndex
CREATE INDEX "Finding_githubCommentId_idx" ON "Finding"("githubCommentId");

