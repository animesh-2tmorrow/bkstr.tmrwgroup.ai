import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { Role } from "@/generated/prisma/client";

// Phase 4.5 Stream E — single ADMIN-only guard for every /dashboard/admin/* page.
// Stream F's pages (/dashboard/admin/books, /dashboard/admin/grants) share this
// layout so the role-check / redirect is defined exactly once. Each leaf page
// still runs its own data-fetch under its own auth() call (the session is not
// threaded through the layout — Next.js doesn't pass it down — but the redirect
// short-circuits unauthorized requests before any leaf page renders).
//
// Defense-in-depth: this guard is the layout-level barrier. Individual API
// handlers under /api/admin/* re-check `session.user.role === ADMIN` themselves
// (the layout is UI-affordance only; the API surface is the load-bearing authz
// check — a SUBSCRIBER hand-crafting a curl request must hit 403 server-side).
//
// Scenario G in the implementation prompt: a SUBSCRIBER navigates directly to
// /dashboard/admin/users → this layout runs first → session.user.role is
// SUBSCRIBER → redirect to /dashboard. The leaf page never executes.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.email) {
    redirect("/login");
  }
  if (session.user.role !== Role.ADMIN) {
    redirect("/dashboard");
  }
  return <>{children}</>;
}
