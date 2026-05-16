// Move 1 — forensic watermark for the one-liner install endpoint.
//
// Produces the one-line JSON string written into every install tarball as
// <slug>/.bkstr-install. If an install ever leaks, this is the attribution
// seam: a free install carries the requester IP, a paid install carries
// the subscriber id. The shape is deliberately stable — downstream leak
// forensics greps these field names.

export type WatermarkInput = {
  isFree: boolean;
  ip: string | null;
  subscriberId: string | null;
  slug: string;
  kind: "book" | "skill";
};

/**
 * Build the watermark line. Free installs are anonymous → attribute by IP
 * (subscriberId omitted). Paid installs have a subscriber → attribute by
 * subscriberId, and the IP is omitted (the subscriber id is the stronger,
 * privacy-appropriate key — no need to also retain the IP). `sha` rides
 * along only when GIT_SHA is set in the environment, so a leaked bundle
 * can be tied to the deploy that produced it.
 */
export function buildWatermark(input: WatermarkInput): string {
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    slug: input.slug,
    kind: input.kind,
  };
  if (input.isFree) {
    if (input.ip) record.ip = input.ip;
  } else {
    if (input.subscriberId) record.subscriberId = input.subscriberId;
  }
  if (process.env.GIT_SHA) record.sha = process.env.GIT_SHA;
  return JSON.stringify(record);
}
