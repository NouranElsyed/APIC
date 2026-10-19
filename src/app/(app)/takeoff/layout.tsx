import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { TakeoffShell } from "@/features/takeoff/takeoff-shell";

export default async function TakeoffLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const role = session?.user.role;
  return (
    <TakeoffShell
      showScrap={can(role, "scrapPricing.view")}
      showSteelPricing={can(role, "steelPricing.view")}
    >
      {children}
    </TakeoffShell>
  );
}
