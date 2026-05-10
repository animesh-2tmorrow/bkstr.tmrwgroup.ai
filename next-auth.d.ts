// NextAuth module augmentation — exposes `session.user.id` and `session.user.role`
// on the typed Session/User. The session callback in src/lib/auth/index.ts
// hydrates these from the DB User row; without this declaration TypeScript
// would not see them on `session.user`.
import { DefaultSession, DefaultUser } from "next-auth";
import type { Role } from "@/generated/prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    role: Role;
  }
}
