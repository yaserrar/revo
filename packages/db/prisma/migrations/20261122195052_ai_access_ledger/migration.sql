-- AlterTable
ALTER TABLE "Installation" ADD COLUMN     "accountGithubId" BIGINT;

-- CreateTable
CREATE TABLE "FreeTierUsage" (
    "id" TEXT NOT NULL,
    "accountGithubId" BIGINT,
    "accountLogin" TEXT NOT NULL,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "spentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FreeTierUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FreeTierUsage_accountGithubId_spentAt_idx" ON "FreeTierUsage"("accountGithubId", "spentAt");

-- CreateIndex
CREATE INDEX "FreeTierUsage_accountLogin_spentAt_idx" ON "FreeTierUsage"("accountLogin", "spentAt");

-- CreateIndex
CREATE INDEX "FreeTierUsage_spentAt_idx" ON "FreeTierUsage"("spentAt");

-- CreateIndex
CREATE INDEX "Installation_accountGithubId_idx" ON "Installation"("accountGithubId");

-- Backfill: runs already paid by Revo's key (aiSource revo, or null on older rows) since the
-- start of last UTC month, so the counters keep what accounts used before this ledger existed.
INSERT INTO "FreeTierUsage" ("id", "accountGithubId", "accountLogin", "costUsd", "spentAt")
SELECT gen_random_uuid()::text, NULL, i."accountLogin", c."costUsd", c."spentAt"
FROM "ReviewCost" c
JOIN "Repo" r ON r."id" = c."repoId"
JOIN "Installation" i ON i."id" = r."installationId"
WHERE (c."aiSource" IS NULL OR c."aiSource" = 'revo')
  AND c."spentAt" >= date_trunc('month', timezone('UTC', now())) - interval '1 month';
