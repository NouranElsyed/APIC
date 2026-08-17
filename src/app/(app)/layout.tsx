import { redirect } from "next/navigation";
import { auth } from "@/server/auth/config";
import { AppShellServer } from "@/components/layout/app-shell-server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <AppShellServer user={session.user}>{children}</AppShellServer>;
}
