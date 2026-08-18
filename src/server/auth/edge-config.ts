import NextAuth, { type DefaultSession, type NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

// ⚠️ This file must stay free of Node-only imports (Prisma, bcryptjs, etc).
// It is imported by src/proxy.ts (Next.js 16's file convention for what
// used to be src/middleware.ts). Any Prisma-dependent logic (the
// Credentials `authorize` callback) lives only in `./config.ts`, which is
// used by the API route handlers and server code that run on the
// Node.js runtime.

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      department: string | null;
    } & DefaultSession["user"];
  }
  interface User {
    role: Role;
    department: string | null;
  }
}

export interface AppToken {
  id: string;
  role: Role;
  department: string | null;
  [key: string]: unknown;
}

// Shared, edge-safe config: session/jwt handling only, no providers here.
export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    async jwt({ token, user }) {
      const t = token as AppToken;
      if (user) {
        t.id = user.id as string;
        t.role = user.role;
        t.department = user.department;
      }
      return t;
    },
    async session({ session, token }) {
      const t = token as AppToken;
      if (session.user) {
        session.user.id = t.id;
        session.user.role = t.role;
        session.user.department = t.department;
      }
      return session;
    },
  },
};

// Edge-safe `auth()` — reads/verifies the JWT only, never touches Prisma.
// Use this in middleware.ts and anywhere else that runs on the Edge Runtime.
export const { auth } = NextAuth(authConfig);
