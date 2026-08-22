import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { ScrapPricingView } from "@/features/scrap-pricing/scrap-pricing-view";

export default async function ScrapMaterialPage() {
  const session = await auth();
  const role = session?.user.role;
  return <ScrapPricingView canExport={can(role, "scrapPricing.export")} />;
}
