import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getPurchaseOrder } from "@/server/services/purchasing.service";
import { getSettings } from "@/server/services/settings.service";
import { PrintPurchaseOrder } from "@/features/procurement/print-purchase-order";

export default async function PrintPurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!can(session?.user.role, "procurement.view")) notFound();
  const [po, settings] = await Promise.all([getPurchaseOrder(id), getSettings()]);
  if (!po) notFound();
  return <PrintPurchaseOrder po={po} company={{ name: settings.name, address: settings.address, phone: settings.phone, email: settings.email }} />;
}
