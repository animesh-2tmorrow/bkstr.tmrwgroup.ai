"use client";

import { useCallback, useEffect, useState } from "react";
import { GenerateKeyModal } from "@/components/api-keys/generate-key-modal";

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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="text-sm text-gray-500 mt-1">
            Issue and revoke keys for the agent fetch endpoint.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowGenerate(true)}
          className="bg-black text-[#FAF6EC] px-4 py-2 rounded-lg text-sm font-bold hover:bg-black shadow-sm"
        >
          Generate new key
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      <div className="bg-[#FAF6EC] border border-[#E5DCC8] rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#EFE8D8] border-b border-[#E5DCC8]">
            <tr>
              <th className="px-6 py-4 font-semibold text-gray-600">Name</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Prefix</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Created</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Last used</th>
              <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
              <th className="px-6 py-4 font-semibold text-gray-600 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5DCC8]">
            {loading && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                  No keys yet. Generate one to call the agent fetch endpoint.
                </td>
              </tr>
            )}
            {!loading &&
              keys.map((row) => {
                const revoked = Boolean(row.revokedAt);
                return (
                  <tr key={row.id} className="hover:bg-[#F5F0E6] transition-colors">
                    <td className="px-6 py-4">
                      {row.name?.trim() ? (
                        <span className="font-medium text-gray-900">{row.name}</span>
                      ) : (
                        <span className="italic text-gray-400">(no name)</span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-gray-700">{row.keyPrefix}</td>
                    <td className="px-6 py-4">
                      <span title={new Date(row.createdAt).toLocaleString()}>
                        {relativeTime(row.createdAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span title={row.lastUsedAt ? new Date(row.lastUsedAt).toLocaleString() : ""}>
                        {relativeTime(row.lastUsedAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      {revoked ? (
                        <span className="inline-flex items-center gap-1.5 bg-[#EAE2D0] text-gray-600 px-2 py-1 rounded text-xs font-bold">
                          Revoked
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 bg-green-50 text-green-700 px-2 py-1 rounded text-xs font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Active
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!revoked && (
                        <button
                          type="button"
                          onClick={() => handleRevoke(row)}
                          disabled={revokingId === row.id}
                          className="text-black font-semibold underline hover:no-underline disabled:opacity-50"
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
