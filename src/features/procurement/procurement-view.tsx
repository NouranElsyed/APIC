"use client";
import * as React from "react";
import { cn } from "@/lib/utils";
import type { PurchaseOrderDTO, ReceiptDTO } from "@/server/services/purchasing.service";
import type { StockDTO } from "@/server/services/stock.service";
import type { SupplierDTO } from "@/server/services/suppliers.service";
import { OrdersPanel, type ProjectOpt } from "./orders-panel";
import { ReceiptsPanel } from "./receipts-panel";
import { StockPanel } from "./stock-panel";
import { SuppliersPanel } from "./suppliers-panel";

type Tab = "orders" | "receipts" | "suppliers" | "stock";

export interface ProcurementData {
  orders: PurchaseOrderDTO[]; receipts: ReceiptDTO[]; suppliers: SupplierDTO[]; stock: StockDTO[]; projects: ProjectOpt[];
}
export interface ProcurementAccess { edit: boolean; receive: boolean; stock: boolean; viewProcurement: boolean }

export function ProcurementView({ data, access }: { data: ProcurementData; access: ProcurementAccess }) {
  const tabs: { key: Tab; label: string; count?: number; show: boolean }[] = [
    { key: "orders", label: "Purchase orders", count: data.orders.filter((o) => o.state === "NOT_RECEIVED" || o.state === "PARTIAL").length, show: access.viewProcurement },
    { key: "receipts", label: "Receipts", show: access.viewProcurement },
    { key: "suppliers", label: "Suppliers", show: access.viewProcurement },
    { key: "stock", label: "Sheet & remnant stock", show: true },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = React.useState<Tab>(visible[0].key);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-border" role="tablist">
        {visible.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={cn("-mb-px border-b-2 px-4 py-2.5 text-sm font-medium transition-colors", tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t.label}{t.count ? <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">{t.count} open</span> : null}
          </button>
        ))}
      </div>
      {tab === "orders" && <OrdersPanel orders={data.orders} suppliers={data.suppliers} projects={data.projects} canEdit={access.edit} canReceive={access.receive} />}
      {tab === "receipts" && <ReceiptsPanel receipts={data.receipts} />}
      {tab === "suppliers" && <SuppliersPanel suppliers={data.suppliers} canEdit={access.edit} />}
      {tab === "stock" && <StockPanel stock={data.stock} projects={data.projects} canEdit={access.stock} />}
    </div>
  );
}
