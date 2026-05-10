import { PrismaAdapter } from "@next-auth/prisma-adapter";
import { getServerSession, type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { prisma } from "@/lib/db";

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.warn("[auth] GOOGLE_CLIENT_ID/SECRET missing — Google sign-in will fail until /etc/bkstr/oauth.env is sourced.");
}
if (!process.env.NEXTAUTH_SECRET) {
  console.warn("[auth] NEXTAUTH_SECRET missing — sessions will not encrypt correctly.");
}
if (!process.env.ALLOWED_EMAIL_DOMAINS && !process.env.ALLOWED_EMAILS) {
  console.warn("[auth] ALLOWED_EMAIL_DOMAINS and ALLOWED_EMAILS both missing — all Google sign-ins will be rejected (fail-closed) until at least one is set.");
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
  ],
  session: { strategy: "database" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      const email = (user?.email ?? "").toLowerCase().trim();
      if (!email) {
        console.warn("[auth] signIn rejected: no email on user");
        return false;
      }
      const allowedDomains = parseList(process.env.ALLOWED_EMAIL_DOMAINS);
      const allowedEmails = parseList(process.env.ALLOWED_EMAILS);
      if (allowedDomains.length === 0 && allowedEmails.length === 0) {
        console.warn(`[auth] signIn rejected (allowlist empty, fail-closed): ${email}`);
        return false;
      }
      if (allowedEmails.includes(email)) return true;
      const domain = email.split("@")[1] ?? "";
      if (allowedDomains.includes(domain)) return true;
      console.warn(`[auth] signIn rejected (domain not allowed): ${email}`);
      return false;
    },
    async session({ session, user }) {
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
        // Phase 3 Stream 3 — hydrate role from the User row so ADMIN-gated
        // surfaces (pricing UI, future moderation) can read session.user.role.
        // The next-auth.d.ts augmentation pre-declared the type at Stream 1
        // patch time; this is the runtime fill-in. Database-strategy sessions
        // call this callback every request so a role bump propagates without
        // requiring sign-out.
        const userWithRole = user as { role?: string };
        if (userWithRole.role) {
          (session.user as { role?: string }).role = userWithRole.role;
        }
      }
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      if (!user.id || !user.email) {
        throw new Error(`createUser event fired without id/email: ${JSON.stringify(user)}`);
      }
      await prisma.subscriber.create({
        data: {
          userId: user.id,
          companyName: user.name?.trim() || "Personal",
          email: user.email,
        },
      });
    },
  },
};

export const auth = () => getServerSession(authOptions);
