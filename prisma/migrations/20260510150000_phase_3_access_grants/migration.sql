-- CreateEnum
CREATE TYPE "GrantSource" AS ENUM ('MANUAL', 'SUBSCRIPTION', 'PURCHASE', 'SEED');

-- CreateTable
CREATE TABLE "access_grants" (
    "id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "book_id" UUID NOT NULL,
    "source" "GrantSource" NOT NULL,
    "stripe_subscription_id" VARCHAR(64),
    "stripe_payment_intent_id" VARCHAR(64),
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "granted_by" UUID,

    CONSTRAINT "access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "access_grants_subscriber_id_book_id_idx" ON "access_grants"("subscriber_id", "book_id");

-- CreateIndex
CREATE INDEX "access_grants_stripe_subscription_id_idx" ON "access_grants"("stripe_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "access_grants_subscriber_id_book_id_source_key" ON "access_grants"("subscriber_id", "book_id", "source");

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_book_id_fkey" FOREIGN KEY ("book_id") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed SEED-source grants for every existing (subscriber, book) pair (D9.6 / ACCESS-Q2).
-- Backfills implicit Phase 2 access so the route's authorization check (later patch behind
-- ENFORCE_BOOK_ACCESS env flag) doesn't 403 existing subscribers when it goes hot.
-- Idempotent via ON CONFLICT against the (subscriber_id, book_id, source) unique index above.
INSERT INTO "access_grants" ("id", "subscriber_id", "book_id", "source", "granted_at")
SELECT gen_random_uuid(), s.id, b.id, 'SEED'::"GrantSource", CURRENT_TIMESTAMP
FROM "subscribers" s CROSS JOIN "books" b
ON CONFLICT ("subscriber_id", "book_id", "source") DO NOTHING;
