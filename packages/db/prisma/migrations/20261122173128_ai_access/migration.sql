-- CreateEnum
CREATE TYPE "AiAccess" AS ENUM ('free', 'own_key', 'subscription');

-- CreateEnum
CREATE TYPE "AiSource" AS ENUM ('revo', 'account', 'subscription');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SkipReason" ADD VALUE 'free_limit';
ALTER TYPE "SkipReason" ADD VALUE 'free_paused';

-- AlterTable
ALTER TABLE "Installation" ADD COLUMN     "aiAccess" "AiAccess" NOT NULL DEFAULT 'free',
ADD COLUMN     "aiAccessUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "aiAccessUpdatedBy" TEXT,
ADD COLUMN     "anthropicKeyEnc" TEXT,
ADD COLUMN     "anthropicKeyHint" TEXT;

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "aiSource" "AiSource";

-- AlterTable
ALTER TABLE "ReviewCost" ADD COLUMN     "aiSource" "AiSource";
