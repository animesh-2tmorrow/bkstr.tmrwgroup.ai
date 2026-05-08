-- AlterTable
ALTER TABLE "subscriber_api_keys" ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "subscriber_api_keys_key_prefix_idx" ON "subscriber_api_keys"("key_prefix");

