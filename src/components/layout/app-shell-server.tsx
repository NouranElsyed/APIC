import { AppShell } from "./app-shell";
import type { Role } from "@prisma/client";

export function AppShellServer({
  user,
  children,
}: {
  user: { name?: string | null; email?: string | null; role: Role };
  children: React.ReactNode;
}) {
  return (
    <AppShell user={{ name: user.name ?? "User", email: user.email ?? "", role: user.role }}>
      {children}
    </AppShell>
  );
}
