-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('User', 'Organization');

-- CreateEnum
CREATE TYPE "PrState" AS ENUM ('open', 'merged', 'closed');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('queued', 'running', 'done', 'skipped', 'failed');

-- CreateEnum
CREATE TYPE "SkipReason" AS ENUM ('draft', 'bot', 'budget', 'too_large', 'no_reviewable_files', 'disabled');

-- CreateEnum
CREATE TYPE "ReviewTrigger" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "ScoreLabel" AS ENUM ('good_to_merge', 'needs_a_look', 'changes_needed');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('blocker', 'major', 'minor');

-- CreateEnum
CREATE TYPE "FeedbackOutcome" AS ENUM ('useful', 'wrong');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "login" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenEnc" TEXT,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "accessCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoAccess" (
    "userId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoAccess_pkey" PRIMARY KEY ("userId","repoId")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "accountAvatarUrl" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL,
    "githubId" BIGINT NOT NULL,
    "fullName" TEXT NOT NULL,
    "private" BOOLEAN NOT NULL DEFAULT true,
    "installationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoSettings" (
    "repoId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-5-5',
    "categories" TEXT[] DEFAULT ARRAY['bug', 'security', 'performance', 'error-handling', 'data', 'missing-test']::TEXT[],
    "ignoreGlobs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "threshold" INTEGER NOT NULL DEFAULT 70,
    "maxFindings" INTEGER NOT NULL DEFAULT 5,
    "reviewDrafts" BOOLEAN NOT NULL DEFAULT false,
    "reviewBots" BOOLEAN NOT NULL DEFAULT false,
    "inlineComments" BOOLEAN NOT NULL DEFAULT true,
    "instructions" TEXT NOT NULL DEFAULT '',
    "monthlyBudgetUsd" DECIMAL(10,2) NOT NULL DEFAULT 20,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoSettings_pkey" PRIMARY KEY ("repoId")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "githubId" BIGINT,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "author" TEXT NOT NULL,
    "authorAvatarUrl" TEXT,
    "baseRef" TEXT NOT NULL,
    "headRef" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "state" "PrState" NOT NULL DEFAULT 'open',
    "url" TEXT NOT NULL,
    "summaryCommentId" BIGINT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mergedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "headSha" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'queued',
    "skipReason" "SkipReason",
    "trigger" "ReviewTrigger" NOT NULL DEFAULT 'auto',
    "score" INTEGER,
    "label" "ScoreLabel",
    "passed" BOOLEAN,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "filesReviewed" INTEGER NOT NULL DEFAULT 0,
    "filesSkipped" INTEGER NOT NULL DEFAULT 0,
    "skippedFiles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error" TEXT,
    "checkRunId" BIGINT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "originalSeverity" "Severity",
    "file" TEXT NOT NULL,
    "lineStart" INTEGER NOT NULL,
    "lineEnd" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "suggestion" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "snippetStartLine" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL,
    "verified" BOOLEAN NOT NULL,
    "rejectReason" TEXT,
    "posted" BOOLEAN NOT NULL DEFAULT false,
    "githubCommentId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "outcome" "FeedbackOutcome" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "action" TEXT,
    "installationGithubId" BIGINT,
    "repoGithubId" BIGINT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

-- CreateIndex
CREATE INDEX "RepoAccess_repoId_idx" ON "RepoAccess"("repoId");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_githubId_key" ON "Installation"("githubId");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_githubId_key" ON "Repo"("githubId");

-- CreateIndex
CREATE INDEX "Repo_installationId_idx" ON "Repo"("installationId");

-- CreateIndex
CREATE INDEX "Repo_fullName_idx" ON "Repo"("fullName");

-- CreateIndex
CREATE INDEX "PullRequest_repoId_state_idx" ON "PullRequest"("repoId", "state");

-- CreateIndex
CREATE INDEX "PullRequest_lastReviewedAt_idx" ON "PullRequest"("lastReviewedAt");

-- CreateIndex
CREATE INDEX "PullRequest_author_idx" ON "PullRequest"("author");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequest_repoId_number_key" ON "PullRequest"("repoId", "number");

-- CreateIndex
CREATE INDEX "Review_createdAt_idx" ON "Review"("createdAt");

-- CreateIndex
CREATE INDEX "Review_repoId_createdAt_idx" ON "Review"("repoId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_pullRequestId_createdAt_idx" ON "Review"("pullRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_status_idx" ON "Review"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Review_pullRequestId_headSha_key" ON "Review"("pullRequestId", "headSha");

-- CreateIndex
CREATE INDEX "Finding_reviewId_verified_idx" ON "Finding"("reviewId", "verified");

-- CreateIndex
CREATE INDEX "Finding_file_idx" ON "Finding"("file");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Feedback_findingId_userId_key" ON "Feedback"("findingId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_deliveryId_key" ON "WebhookDelivery"("deliveryId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_receivedAt_idx" ON "WebhookDelivery"("receivedAt");

-- AddForeignKey
ALTER TABLE "RepoAccess" ADD CONSTRAINT "RepoAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoAccess" ADD CONSTRAINT "RepoAccess_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoSettings" ADD CONSTRAINT "RepoSettings_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
