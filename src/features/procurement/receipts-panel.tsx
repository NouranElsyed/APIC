"use client";
import * as React from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ReceiptDTO } from "@/server/services/purchasing.service";
import { Empty, fmtDate, num, Pill, Td, Th } from "./ui";

export function ReceiptsPanel({ receipts }: { receipts: ReceiptDTO[] }) {
  const [q, setQ] = React.useState("");
  const term = q.trim().toLowerCase();
  const shown = term
    ? receipts.filter((r) => [r.number, r.deliveryNote ?? "", r.purchaseOrder.number, r.purchaseOrder.supplier, r.purchaseOrder.project, ...r.lines.flatMap((l) => [l.heatNo ?? "", l.certificateRef ?? "", l.description])].join(" ").toLowerCase().includes(term))
    : receipts;

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Search heat no., certificate, PO, supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {shown.length === 0 ? <Empty text={receipts.length ? "No receipt matches your search." : "Nothing received yet. Receive goods from a purchase order."} /> : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/50"><tr><Th>Receipt</Th><Th>Date</Th><Th>Purchase order</Th><Th>Delivery note</Th><Th>Material received</Th></tr></thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-muted/30">
                  <Td className="font-medium">{r.number}<p className="text-xs font-normal text-muted-foreground">by {r.receivedByName}</p></Td>
                  <Td>{fmtDate(r.receivedDate)}</Td>
                  <Td>{r.purchaseOrder.number}<p className="text-xs text-muted-foreground">{r.purchaseOrder.supplier} · {r.purchaseOrder.project}</p></Td>
                  <Td>{r.deliveryNote ?? "—"}</Td>
                  <Td>
                    <ul className="space-y-1.5">
                      {r.lines.map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium">{l.description}</span>{l.spec && <span className="text-xs text-muted-foreground">{l.spec}</span>}
                          <span className="tabular-nums">{num(l.qty)} {l.unit}</span>
                          {l.heatNo && <Pill tone="info">Heat {l.heatNo}</Pill>}
                          {l.certificateRef && <Pill tone="muted">MTC {l.certificateRef}</Pill>}
                          {!l.accepted && <Pill tone="bad">Rejected</Pill>}
                        </li>
                      ))}
                    </ul>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
