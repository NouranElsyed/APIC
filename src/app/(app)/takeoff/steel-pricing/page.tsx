import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { SteelPricingView } from "@/features/steel-pricing/steel-pricing-view";

export default async function SteelPricingPage() {
  const session = await auth();
  const role = session?.user.role;
  return <SteelPricingView canExport={can(role, "steelPricing.export")} />;
}
