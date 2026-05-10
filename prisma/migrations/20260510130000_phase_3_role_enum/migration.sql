-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUBSCRIBER', 'PUBLISHER', 'ADMIN');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'SUBSCRIBER';

-- Backfill: promote the operator identity to ADMIN. Other existing users
-- (animeshk604@gmail.com, clawbot@tmrwgroup.ai) keep the SUBSCRIBER default.
UPDATE "users" SET "role" = 'ADMIN' WHERE "email" = 'animesh@2tmorrow.com';
