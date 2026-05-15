"use client";

import { useEffect, useState } from "react";

// bkstr redesign PR 7 — restyled with design tokens.
//
// The modal interior is in scope for PR 7 (unlike PR 5's admin modals,
// which were deferred): this is the primary CTA experience for the page,
// and the "show plaintext once" panel IS the deliverable. Keeping it on
// hex while everything around it is on tokens would be visually jarring
// in the moment that matters most.

type GeneratedKey = { id: string; name: string; plaintext: string; prefix: string };

export function GenerateKeyModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [stage, setStage] = useState<"name" | "show">("name");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<GeneratedKey | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && stage === "name") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, stage]);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as GeneratedKey;
      setGenerated(body);
      setStage("show");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate key");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopy() {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.plaintext);
      setCopyState("copied");
      setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      // clipboard write may fail in some browser contexts; the user can still select+copy
    }
  }

  function handleDone() {
    setGenerated(null);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-lg bg-paper border border-rule p-8">
        {stage === "name" && (
          <form onSubmit={handleGenerate} className="space-y-5">
            <div>
              <h2 className="font-serif text-[24px] tracking-display text-ink mb-1.5">Generate API key</h2>
              <p className="text-sm text-ink-3">
                Name it so you can identify it later (e.g. &ldquo;production&rdquo;, &ldquo;CI&rdquo;).
              </p>
            </div>
            <div>
              <label htmlFor="key-name" className="block font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 mb-1.5">
                Name
              </label>
              <input
                id="key-name"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3 py-2 border border-rule bg-paper text-sm text-ink focus:outline-none focus:border-ink placeholder:text-ink-4"
                placeholder="production"
                autoFocus
              />
            </div>
            {error && <p className="font-mono text-[11px] text-status-err">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 hover:text-ink hover:bg-paper-2 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-ink text-paper px-4 py-2 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 disabled:opacity-50 transition-colors"
              >
                {submitting ? "Generating…" : "Generate"}
              </button>
            </div>
          </form>
        )}

        {stage === "show" && generated && (
          <div className="space-y-5">
            <div>
              <h2 className="font-serif text-[24px] tracking-display text-ink mb-1.5">Your new API key</h2>
              <p className="text-sm text-ink-3">
                Copy this key now. You will not be able to see it again.
              </p>
            </div>

            <div className="bg-paper-2 border border-rule p-4">
              <div className="flex items-center gap-3">
                <code className="flex-1 font-mono text-sm break-all text-ink select-all">
                  {generated.plaintext}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="bg-ink text-paper px-3 py-1.5 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 transition-colors shrink-0"
                >
                  {copyState === "copied" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm text-ink-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1 accent-ink"
              />
              <span>I have copied this key and stored it securely.</span>
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleDone}
                disabled={!confirmed}
                className="bg-ink text-paper px-4 py-2 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 disabled:opacity-40 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
