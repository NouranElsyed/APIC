import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { listProjects } from "@/server/services/project.service";
import { listSuppliers } from "@/server/services/suppliers.service";
import { listPurchaseOrders, listReceipts } from "@/server/services/purchasing.service";
import { listStock } from "@/server/services/stock.service";
import { ProcurementView } from "@/features/procurement/procurement-view";

export default async function ProcurementPage() {
  const session = await auth();
  const role = session?.user.role;
  const viewProcurement = can(role, "procurement.view");
  if (!viewProcurement && !can(role, "stock.view")) notFound();

  const [projects, suppliers, orders, receipts, stock] = await Promise.all([
    listProjects(),
    viewProcurement ? listSuppliers() : [],
    viewProcurement ? listPurchaseOrders() : [],
    viewProcurement ? listReceipts() : [],
    listStock(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Procurement &amp; Stock</h1>
        <p className="text-sm text-muted-foreground">Order the steel, record what arrives with its heat number and certificate, and keep track of sheets and remnants.</p>
      </div>
      <ProcurementView
        data={{ orders, receipts, suppliers, stock, projects: projects.map((p) => ({ id: p.id, number: p.number, name: p.name })) }}
        access={{ edit: can(role, "procurement.edit"), receive: can(role, "procurement.receive"), stock: can(role, "stock.edit"), viewProcurement }}
      />
    </div>
  );
}
