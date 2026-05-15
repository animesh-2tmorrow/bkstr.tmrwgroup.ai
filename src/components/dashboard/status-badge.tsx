// bkstr redesign PR 7 — fetch-log status pill on design tokens.
//
// Maps Bedrock-call statuses to the four design-system status colors
// (status-ok / status-warn / status-err / paper). Square corners, mono
// uppercase label, dot affordance preserved.

type Tone = "ok" | "warn" | "err" | "neutral";

const STATUS_TONES: Record<string, Tone> = {
  success: "ok",
  cache_hit: "ok",
  timeout: "warn",
  content_too_large: "warn",
  error: "err",
};

const STATUS_LABELS: Record<string, string> = {
  success: "Success",
  cache_hit: "Cache hit",
  timeout: "Timeout",
  content_too_large: "Too large",
  error: "Error",
};

const TONE_CHIP: Record<Tone, string> = {
  ok: "bg-status-ok/10 text-status-ok border border-status-ok/30",
  warn: "bg-status-warn/10 text-status-warn border border-status-warn/30",
  err: "bg-status-err/10 text-status-err border border-status-err/30",
  neutral: "bg-paper-2 text-ink-3 border border-rule",
};

const TONE_DOT: Record<Tone, string> = {
  ok: "bg-status-ok",
  warn: "bg-status-warn",
  err: "bg-status-err",
  neutral: "bg-ink-4",
};

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = STATUS_TONES[status] ?? "neutral";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] tracking-eyebrow uppercase ${TONE_CHIP[tone]}`}>
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} />
      {label}
    </span>
  );
}
