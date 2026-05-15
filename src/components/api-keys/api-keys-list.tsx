"use client";

import { useCallback, useEffect, useState } from "react";
import { GenerateKeyModal } from "@/components/api-keys/generate-key-modal";
import { Eyebrow } from "@/components/design";

// bkstr redesign PR 7 — restyled with design tokens.
// The page header is rendered here (inside the client island) so the
// "Generate new key" CTA stays adjacent to the modal it opens.

type ApiKeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ApiKeysList() {
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/keys", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { keys: ApiKeyRow[] };
      setKeys(body.keys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleRevoke(row: ApiKeyRow) {
    const label = row.name?.trim() ? `"${row.name}"` : `"${row.keyPrefix}"`;
    if (!window.confirm(`Revoke ${label}? This cannot be undone.`)) return;
    setRevokingId(row.id);
    try {
      const res = await fetch(`/api/keys/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke key");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div>
      <header className="mb-8 flex justify-between items-end gap-4">
        <div>
          <Eyebrow>§ ACCESS · AGENT API CREDENTIALS</Eyebrow>
          <h1 className="font-serif font-normal text-[36px] leading-[1.05] tracking-display text-ink mt-3 mb-2">
            API Keys
          </h1>
          <p className="text-ink-3 text-sm max-w-[72ch]">
            Issue and revoke keys for the agent fetch endpoint. Each key is
            shown in plaintext exactly once at issuance — copy it then.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowGenerate(true)}
          className="bg-ink text-paper px-4 py-2 font-mono text-[11px] tracking-eyebrow uppercase hover:bg-ink-2 transition-colors shrink-0"
        >
          Generate new key
        </button>
      </header>

      {error && (
        <div className="mb-4 bg-status-err/10 border border-status-err/30 text-status-err text-sm px-4 py-3">
          {error}
        </div>
      )}

      <div className="bg-paper border border-rule overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-ink">
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Name</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Prefix</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Created</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Last used</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal">Status</th>
              <th className="px-6 py-3 font-mono text-[11px] tracking-eyebrow uppercase text-ink-3 font-normal text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-ink-3 text-sm">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-ink-3 text-sm">
                  No keys yet. Generate one to call the agent fetch endpoint.
                </td>
              </tr>
            )}
            {!loading &&
              keys.map((row) => {
                const revoked = Boolean(row.revokedAt);
                return (
                  <tr key={row.id} className="border-b border-rule hover:bg-paper-2 transition-colors">
                    <td className="px-6 py-4">
                      {row.name?.trim() ? (
                        <span className="font-serif text-ink">{row.name}</span>
                      ) : (
                        <span className="italic text-ink-4 font-serif">(no name)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-2">{row.keyPrefix}</td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-3">
                      <span title={new Date(row.createdAt).toLocaleString()}>
                        {relativeTime(row.createdAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px] text-ink-3">
                      <span title={row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : ""}>
                        {relativeTime(row.lastUsedAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {revoked ? (
                        <span className="inline-flex items-center gap-1.5 bg-paper-2 border border-rule text-ink-3 px-2 py-1 font-mono text-[11px] tracking-eyebrow uppercase">
                          Revoked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 bg-status-ok/10 border border-status-ok/30 text-status-ok px-2 py-1 font-mono text-[11px] tracking-eyebrow uppercase">
                          <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-status-ok" /> Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!revoked && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(row)}
                          disabled={revokingId === row.id}
                          className="font-mono text-[11px] tracking-eyebrow uppercase text-status-err hover:text-ink underline-offset-2 hover:underline disabled:opacity-50"
                        >
                          {revokingId === row.id ? "Revoking…" : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {showGenerate && (
        <GenerateKeyModal
          onClose={() => setShowGenerate(false)}
          onCreated={() => {
            void refresh();
          }}
        />
      )}
    </div>
  );
}
