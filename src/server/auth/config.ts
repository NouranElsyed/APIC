import NextAuth, { type DefaultSession } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db/client";
import type { Role } from "@prisma/client";

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

interface AppToken {
  id: string;
  role: Role;
  department: string | null;
  [key: string]: unknown;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.active) return null;

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return null;

        await prisma.activityLog.create({
          data: { userId: user.id, action: "LOGIN", entity: "USER", entityId: user.id },
        });

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
        };
      },
    }),
  ],
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
});
