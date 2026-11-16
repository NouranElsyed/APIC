"use client";
import { Printer } from "lucide-react";
import { parseTerms } from "./terms-editor";
import { Button } from "@/components/ui/button";
import type { PurchaseOrderDTO } from "@/server/services/purchasing.service";
import { fmtDate, money, num } from "./ui";

/** Printable purchase order (use the browser's "Save as PDF"). */
export function PrintPurchaseOrder({ po, company }: { po: PurchaseOrderDTO; company: { name: string; address: string | null; phone: string | null; email: string | null } }) {
  return (
    <div className="mx-auto max-w-[820px] space-y-5 bg-white p-8 text-sm text-black print:p-0">
      <style>{`@page { size: A4; margin: 14mm; } @media print { .no-print { display: none !important; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="no-print flex justify-end"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Button></div>
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div><h1 className="text-xl font-bold">{company.name}</h1><p className="text-xs text-gray-600">{[company.address, company.phone, company.email].filter(Boolean).join(" · ")}</p></div>
        <div className="text-right"><p className="text-lg font-bold tracking-wide">PURCHASE ORDER</p><p className="font-semibold">{po.number}</p></div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <div><p className="text-xs font-semibold uppercase text-gray-500">Supplier</p><p className="font-semibold">{po.supplier.name}</p></div>
        <div className="text-right"><p><span className="text-gray-500">Date:</span> {fmtDate(po.orderDate)}</p><p><span className="text-gray-500">Expected:</span> {fmtDate(po.expectedDate)}</p><p><span className="text-gray-500">Project:</span> {po.project.number} — {po.project.name}</p></div>
      </div>
      <table className="w-full border-collapse">
        <thead><tr className="bg-gray-100 text-left text-xs"><th className="border border-gray-300 p-2">#</th><th className="border border-gray-300 p-2">Description</th><th className="border border-gray-300 p-2 text-right">Qty</th><th className="border border-gray-300 p-2">Unit</th><th className="border border-gray-300 p-2 text-right">Unit price</th><th className="border border-gray-300 p-2 text-right">Amount</th></tr></thead>
        <tbody>
          {po.lines.map((l, i) => (
            <tr key={l.id}>
              <td className="border border-gray-300 p-2">{i + 1}</td>
              <td className="border border-gray-300 p-2">{l.description}{l.spec && <span className="text-gray-600"> — {l.spec}</span>}</td>
              <td className="border border-gray-300 p-2 text-right tabular-nums">{num(l.orderedQty)}</td>
              <td className="border border-gray-300 p-2">{l.unit}</td>
              <td className="border border-gray-300 p-2 text-right tabular-nums">{l.unitPrice != null ? money(l.unitPrice, po.currency) : "—"}</td>
              <td className="border border-gray-300 p-2 text-right tabular-nums">{l.unitPrice != null ? money(l.orderedQty * l.unitPrice, po.currency) : "—"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="font-bold"><td colSpan={5} className="border border-gray-300 p-2 text-right">Total</td><td className="border border-gray-300 p-2 text-right tabular-nums">{po.total > 0 ? money(po.total, po.currency) : "—"}</td></tr></tfoot>
      </table>
      {(po.paymentTerms || po.notes) && <div className="text-xs">{po.paymentTerms && (parseTerms(po.paymentTerms).length === 1 ? <p><b>Payment terms:</b> {parseTerms(po.paymentTerms)[0]}</p> : <div><p><b>Payment terms:</b></p><ol className="ml-5 list-decimal">{parseTerms(po.paymentTerms).map((t, i) => <li key={i}>{t}</li>)}</ol></div>)}{po.notes && <p><b>Notes:</b> {po.notes}</p>}</div>}
      <p className="pt-6 text-xs text-gray-600">Please state the heat number and attach the mill test certificate (MTC) for every delivery of steel. Prepared by {po.createdByName}.</p>
    </div>
  );
}
