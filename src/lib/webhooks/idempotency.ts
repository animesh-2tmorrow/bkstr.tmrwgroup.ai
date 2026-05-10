import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

// Phase 3 Stream 3 — webhook idempotency helper.
// Implements the two-phase status pattern locked in CC-1 / D10.1: a webhook
// row's lifecycle is INSERT(status='received') → handler runs → UPDATE
// (status='processed' on success, or status='error' + error_message on
// failure). Retries: if a row exists with status != 'processed', the helper
// re-runs the handler. Pattern B (single DB transaction wrapping handler) was
// rejected because handlers may do work outside the local DB (e.g. Stripe API
// calls, S3 writes), so a transaction can't cleanly bracket them.
//
// Caller passes a stable `eventId` (Stripe `evt_…` strings; S3 SNS event UUIDs
// in a future Stream 2 use); the table's natural-PK shape (D9.3) means
// duplicate INSERT raises P2002 (unique constraint), which we treat as
// "already-seen → check status, decide whether to re-run."

export type IdempotencyResult<T> =
  | { status: "duplicate"; result?: undefined; error?: undefined }
  | { status: "processed"; result: T; error?: undefined }
  | { status: "error"; result?: undefined; error: unknown };

export async function withIdempotency<T>(
  eventId: string,
  source: string,
  handler: () => Promise<T>,
): Promise<IdempotencyResult<T>> {
  // Phase 1: insert-or-detect. Try to claim the eventId by inserting a
  // received row. If the row already exists, look it up and decide.
  let shouldProcess = true;
  try {
    await prisma.webhookEvent.create({
      data: {
        eventId,
        source,
        status: "received",
      },
    });
  } catch (err) {
    // Unique-constraint violation = duplicate delivery. Look up the existing
    // row to decide whether the prior attempt finished successfully.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.webhookEvent.findUnique({
        where: { eventId },
        select: { status: true },
      });
      if (existing?.status === "processed") {
        // True duplicate of a successfully-handled event — short-circuit.
        return { status: "duplicate" };
      }
      // Existing row but status='received' or 'error' — re-process. Reset
      // status so a successful retry transitions cleanly.
      await prisma.webhookEvent.update({
        where: { eventId },
        data: { status: "received", errorMessage: null, processedAt: null },
      });
      shouldProcess = true;
    } else {
      throw err;
    }
  }

  if (!shouldProcess) {
    // Defensive — unreachable given the branches above, but keeps TS happy
    // if logic evolves.
    return { status: "duplicate" };
  }

  // Phase 2: run the handler outside any DB transaction. Failures get logged
  // to error_message + status='error' so retries pick them up; successes flip
  // status='processed' + processed_at=NOW().
  try {
    const result = await handler();
    await prisma.webhookEvent.update({
      where: { eventId },
      data: { status: "processed", processedAt: new Date(), errorMessage: null },
    });
    return { status: "processed", result };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    await prisma.webhookEvent.update({
      where: { eventId },
      data: { status: "error", errorMessage },
    });
    return { status: "error", error };
  }
}
