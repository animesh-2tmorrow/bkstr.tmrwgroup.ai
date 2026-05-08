"use client";

import { useEffect, useState } from "react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg bg-[#FAF6EC] rounded-2xl shadow-lg border border-[#E5DCC8] p-8">
        {stage === "name" && (
          <form onSubmit={handleGenerate} className="space-y-5">
            <div>
              <h2 className="text-xl font-bold mb-1">Generate API key</h2>
              <p className="text-sm text-gray-500">
                Name it so you can identify it later (e.g. &ldquo;production&rdquo;, &ldquo;CI&rdquo;).
              </p>
            </div>
            <div>
              <label htmlFor="key-name" className="block text-sm font-semibold text-gray-700 mb-1">
                Name
              </label>
              <input
                id="key-name"
                type="text"
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field w-full p-3 rounded-lg text-sm bg-[#FAF6EC] border border-[#E5DCC8]"
                placeholder="production"
                autoFocus
              />
            </div>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-[#EAE2D0]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black disabled:opacity-50"
              >
                {submitting ? "Generating…" : "Generate"}
              </button>
            </div>
          </form>
        )}

        {stage === "show" && generated && (
          <div className="space-y-5">
            <div>
              <h2 className="text-xl font-bold mb-1">Your new API key</h2>
              <p className="text-sm text-gray-500">
                Copy this key now. You will not be able to see it again.
              </p>
            </div>

            <div className="bg-[#F5F0E6] border border-[#E5DCC8] rounded-lg p-4">
              <div className="flex items-center gap-3">
                <code className="flex-1 font-mono text-sm break-all text-gray-900">
                  {generated.plaintext}
                </code>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="bg-black text-[#FAF6EC] px-3 py-1.5 rounded text-xs font-bold hover:bg-black"
                >
                  {copyState === "copied" ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1"
              />
              <span>I have copied this key and stored it securely.</span>
            </label>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleDone}
                disabled={!confirmed}
                className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black disabled:opacity-40"
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
