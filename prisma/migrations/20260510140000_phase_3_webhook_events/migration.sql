-- CreateTable
CREATE TABLE "webhook_events" (
    "event_id" VARCHAR(128) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "status" VARCHAR(32) NOT NULL,
    "error_message" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("event_id")
);

-- CreateIndex
CREATE INDEX "webhook_events_source_received_at_idx" ON "webhook_events"("source", "received_at" DESC);
