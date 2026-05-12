import { defineConfig } from "vitest/config";
import path from "node:path";

// Phase 5 Stream E — vitest config so vite resolves the `@/` alias from
// tsconfig.json. Previous test files (src/lib/docs/filter-by-role.test.ts,
// src/lib/admin/assistant/{tools,agent}.test.ts) didn't need this because
// their @/-imports were always type-only (elided at runtime) or covered by
// vi.mock(). The new src/app/api/publisher/books/[id]/archive/route.test.ts
// imports a route module that does VALUE-importing of @/generated/prisma/
// client, which vite's default resolver couldn't find — particularly under
// the Next.js [id] bracket path. Adding the alias here closes the gap.

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
