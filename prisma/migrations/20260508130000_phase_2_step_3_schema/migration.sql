-- AlterTable
ALTER TABLE "book_versions" ADD COLUMN     "content" TEXT;

-- CreateTable
CREATE TABLE "fetch_logs" (
    "id" UUID NOT NULL,
    "subscriber_id" UUID NOT NULL,
    "book_version_id" UUID NOT NULL,
    "api_key_id" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER,
    "status" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fetch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "fetch_logs_subscriber_id_created_at_idx" ON "fetch_logs"("subscriber_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "fetch_logs_book_version_id_idx" ON "fetch_logs"("book_version_id");

-- CreateIndex
CREATE INDEX "fetch_logs_api_key_id_created_at_idx" ON "fetch_logs"("api_key_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "fetch_logs" ADD CONSTRAINT "fetch_logs_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fetch_logs" ADD CONSTRAINT "fetch_logs_book_version_id_fkey" FOREIGN KEY ("book_version_id") REFERENCES "book_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fetch_logs" ADD CONSTRAINT "fetch_logs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "subscriber_api_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

