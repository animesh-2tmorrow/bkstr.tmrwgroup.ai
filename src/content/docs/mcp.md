---
title: "MCP server"
track: agent
role: SUBSCRIBER
order: 5
summary: "Connect Claude Code, Cursor, Codex CLI, or any MCP-compatible client to bkstr through the hosted MCP server."
---

bkstr runs a hosted Model Context Protocol server at `https://mcp.bkstr.tmrwgroup.ai/mcp`. Point any MCP-compatible client at that URL and seven tools appear: four anonymous tools for browsing the catalog, and three authenticated tools for reading and querying the items your account owns. There is nothing to install — the server is shared infrastructure.

The MCP server is a thin wrapper over the same HTTP endpoints documented under [API reference](/dashboard/docs/api) and [Q&A endpoint](/dashboard/docs/qa-endpoint); auth, grants, and rate limits are all enforced by the bkstr web app. If you prefer raw HTTP calls or a CLI, those paths still work — MCP is one more shape, not a replacement.

## Available tools

| Tool | Auth | What it does |
|---|---|---|
| `search_catalog` | none | Free-text search of the marketplace. Returns slug, title, kind, price, publisher. |
| `get_item` | none | Full public detail for one item by slug. |
| `get_popular` | none | Most-purchased items, popularity bucketed (never an exact count). |
| `get_publisher` | none | A publisher's profile plus their full active catalog. |
| `my_library` | Bearer | Every book and skill the authenticated subscriber owns. |
| `load_item` | Bearer + grant | Inline chapters (for a book) or inline files (for a skill) the subscriber owns. |
| `ask_book` | Bearer + grant | Natural-language Q&A against one owned book; the answer is streamed back. |

The same access rules as the HTTP API apply: free items are visible to anyone, paid items need both a valid `bks_` key and a live grant on the subscriber account.

## Add the server to your client

The endpoint is `https://mcp.bkstr.tmrwgroup.ai/mcp` and the transport is Streamable HTTP — the modern MCP transport, not stdio. Anonymous tools work with no header at all; authenticated tools need a Bearer key on every request.

### Claude Code

Add the server once with the `claude mcp` CLI. The `--transport http` flag picks Streamable HTTP, and `--header` attaches the Bearer key to every request:

```bash
# Anonymous — only the four browse tools will work
claude mcp add bkstr --transport http https://mcp.bkstr.tmrwgroup.ai/mcp

# Authenticated — paste your key once; Claude Code stores it
claude mcp add bkstr --transport http https://mcp.bkstr.tmrwgroup.ai/mcp \
  --header "Authorization: Bearer $BKSTR_KEY"
```

Create a key at [/dashboard/api-keys](/dashboard/api-keys). Inside Claude Code the seven tools appear under the `bkstr` server in `/mcp`; refer to them by their bare names (`search_catalog`, `my_library`, …) — Claude Code handles the namespacing.

### Cursor

Cursor reads MCP servers from `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` inside a project (per-workspace). Add an entry under `mcpServers`:

```json
{
  "mcpServers": {
    "bkstr": {
      "url": "https://mcp.bkstr.tmrwgroup.ai/mcp",
      "headers": {
        "Authorization": "Bearer bks_your_key_here"
      }
    }
  }
}
```

Drop the `headers` block to use the server anonymously. Restart Cursor after saving the file; the `bkstr` server shows up in the MCP panel with its tool list.

### Codex CLI

Codex reads `~/.codex/config.toml`. Add a `[mcp_servers.bkstr]` block:

```toml
[mcp_servers.bkstr]
url = "https://mcp.bkstr.tmrwgroup.ai/mcp"

[mcp_servers.bkstr.headers]
Authorization = "Bearer bks_your_key_here"
```

Omit the headers table for anonymous use. `codex mcp list` confirms the server is registered.

### Anything else

Any client that speaks Streamable HTTP MCP works the same way: hand it the URL `https://mcp.bkstr.tmrwgroup.ai/mcp`, and (for authenticated tools) attach an `Authorization: Bearer bks_…` header to every request. The server is stateless — no session handshake or persistent connection is required.

## Authentication

Authenticated tools require a `bks_` API key in a Bearer header on every JSON-RPC call:

```
Authorization: Bearer bks_your_key_here
```

Anonymous tools ignore the header. Authenticated tools without a key return `UNAUTHENTICATED`; with a key but no grant on the requested item, `ACCESS_DENIED`. Keys live at [/dashboard/api-keys](/dashboard/api-keys); revoke a leaked one there and it stops authenticating immediately.

## Rate limits

The server uses one shared budget per Bearer key for the authenticated tools. The anonymous tools share a separate budget keyed by client IP. On exhaustion, the tool returns a `RATE_LIMITED` error with a `retry_after_seconds` field; back off for that many seconds before the next call. Burst-heavy automation should pace itself rather than retry tight.

## `ask_book` and the kill-switch

`ask_book` proxies to the bkstr Q&A endpoint, which is the one tool with a meaningful per-call cost. Operations can disable it without a redeploy by flipping a single environment flag — when that flag is off, `ask_book` returns a `FEATURE_DISABLED` error and the other six tools keep working. `search_catalog`, `get_item`, `get_popular`, `get_publisher`, `my_library`, and `load_item` are never gated by the kill-switch.

If `ask_book` returns `FEATURE_DISABLED`, the Q&A surface is the only thing offline — the rest of bkstr is still up. The same key still loads inline content with `load_item`.

## Errors

Every error is a JSON-RPC tool error with a stable `code` and a human-readable `message`. The codes you'll see in practice:

| Code | Meaning |
|---|---|
| `UNAUTHENTICATED` | No Bearer key on an authenticated tool. |
| `ACCESS_DENIED` | Key is valid but the subscriber has no live grant on the item. |
| `NOT_FOUND` | The item or publisher slug does not exist. |
| `RATE_LIMITED` | Per-key (authenticated) or per-IP (anonymous) budget exhausted. Includes `retry_after_seconds`. |
| `FEATURE_DISABLED` | `ask_book` only — kill-switch is off. |
| `UPSTREAM_ERROR` | A transient failure in the bkstr web app or Q&A endpoint. Retry the call. |

Errors are returned as MCP tool errors (`isError: true`), not as JSON-RPC protocol errors — the call itself completes, the *result* carries the failure.
