import { listUsersTool, executeListUsers } from "./list-users";
import { listBooksTool, executeListBooks } from "./list-books";
import { listGrantsTool, executeListGrants } from "./list-grants";
import { readAuditLogTool, executeReadAuditLog } from "./read-audit-log";
import { recentFetchLogsTool, executeRecentFetchLogs } from "./recent-fetch-logs";

// Phase 5 Stream B (D14.5) — tool registry for the admin assistant.
// All 5 tools are read-only Prisma queries with a 200-row hard cap. No
// free-form SQL escape hatch (follow-up #80 tracks adding one once we have
// real demand and the parameterized-query story is firmed up).

export const TOOLS = [
  listUsersTool,
  listBooksTool,
  listGrantsTool,
  readAuditLogTool,
  recentFetchLogsTool,
] as const;

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  // We cast input to each tool's parameter type at the call site — each
  // executeX does manual validation internally so the cast is purely a
  // TypeScript-side concession (no unsafe behavior; the tools are
  // defensive against any missing/malformed fields).
  switch (name) {
    case "list_users":
      return executeListUsers(input as Parameters<typeof executeListUsers>[0]);
    case "list_books":
      return executeListBooks(input as Parameters<typeof executeListBooks>[0]);
    case "list_grants":
      return executeListGrants(input as Parameters<typeof executeListGrants>[0]);
    case "read_audit_log":
      return executeReadAuditLog(input as Parameters<typeof executeReadAuditLog>[0]);
    case "recent_fetch_logs":
      return executeRecentFetchLogs(input as Parameters<typeof executeRecentFetchLogs>[0]);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
