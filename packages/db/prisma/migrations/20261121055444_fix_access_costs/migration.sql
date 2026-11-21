-- CreateEnum
CREATE TYPE "RepoPermission" AS ENUM ('read', 'triage', 'write', 'maintain', 'admin');

-- AlterTable
ALTER TABLE "RepoAccess" ADD COLUMN     "permission" "RepoPermission" NOT NULL DEFAULT 'read';

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReviewCost" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "reviewId" TEXT,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewCost_repoId_spentAt_idx" ON "ReviewCost"("repoId", "spentAt");

-- CreateIndex
CREATE INDEX "ReviewCost_spentAt_idx" ON "ReviewCost"("spentAt");

-- CreateIndex
CREATE INDEX "ReviewCost_reviewId_idx" ON "ReviewCost"("reviewId");

-- AddForeignKey
ALTER TABLE "ReviewCost" ADD CONSTRAINT "ReviewCost_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewCost" ADD CONSTRAINT "ReviewCost_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: what reviews already cost counts when it was spent (their finish time).
INSERT INTO "ReviewCost" ("id", "repoId", "reviewId", "costUsd", "spentAt")
SELECT 'backfill_' || r."id", r."repoId", r."id", r."costUsd", coalesce(r."finishedAt", r."updatedAt")
FROM "Review" r
WHERE r."costUsd" > 0;

-- Permissions were not recorded before: every snapshot is refreshed from GitHub on the next request.
UPDATE "User" SET "accessCheckedAt" = NULL;
