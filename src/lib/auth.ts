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
      if (!user?.id) return true;
      await prisma.subscriber.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          companyName: user.name?.trim() || "Personal",
          email: user.email ?? "",
        },
        update: {},
      });
      return true;
    },
    async session({ session, user }) {
      if (session.user && user) {
        (session.user as { id?: string }).id = user.id;
      }
      return session;
    },
  },
};

export const auth = () => getServerSession(authOptions);
