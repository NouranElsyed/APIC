import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/server/db/client";
import { authConfig } from "./edge-config";

// Full auth config — safe to import from API routes and Node.js server
// code (Server Components, Server Actions, route handlers), but must
// NEVER be imported from src/middleware.ts (Edge Runtime can't run
// Prisma/bcrypt). Middleware uses `./edge-config` instead.

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
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
});
