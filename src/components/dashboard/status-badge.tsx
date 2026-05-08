type Tone = "green" | "yellow" | "red" | "neutral";

const STATUS_TONES: Record<string, Tone> = {
  success: "green",
  cache_hit: "green",
  timeout: "yellow",
  content_too_large: "yellow",
  error: "red",
};

const STATUS_LABELS: Record<string, string> = {
  success: "Success",
  cache_hit: "Cache hit",
  timeout: "Timeout",
  content_too_large: "Too large",
  error: "Error",
};

const TONE_CLASSES: Record<Tone, string> = {
  green: "bg-green-50 text-green-700",
  yellow: "bg-yellow-50 text-yellow-800",
  red: "bg-red-50 text-red-700",
  neutral: "bg-[#EAE2D0] text-gray-600",
};

const TONE_DOTS: Record<Tone, string> = {
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  neutral: "bg-gray-400",
};

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = STATUS_TONES[status] ?? "neutral";
  const label = STATUS_LABELS[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-bold ${TONE_CLASSES[tone]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${TONE_DOTS[tone]}`}></span>
      {label}
    </span>
  );
}
