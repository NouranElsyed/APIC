"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtLong } from "@/features/planning/gantt-chart";
import { daysBetween, STATUS_LABEL, totals, TYPE_LABEL } from "./quotation";
import type { QuotationDetailDTO } from "./dto";

const f = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A4 printout of one quotation — use the browser's "Save as PDF". */
export function QuotationPrint({ q }: { q: QuotationDetailDTO }) {
  const t = totals(q.items);
  return (
    <div className="mx-auto max-w-[900px] space-y-5 bg-white p-8 text-[13px] text-slate-900 print:p-0">
      <style>{`@page { size: A4; margin: 14mm; } @media print { .no-print { display: none !important; } body { background: #fff; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } tr { break-inside: avoid; } }`}</style>
      <div className="no-print flex justify-end"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Button></div>
      <header className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-slate-500">SteelFlow</p><h1 className="text-2xl font-semibold">Quotation {q.number}{q.revision ? ` — Rev. ${q.revision}` : ""}</h1><p className="mt-1 text-slate-600">{q.description}</p></div>
        <div className="text-right text-xs text-slate-600"><p>Status: <b className="text-slate-900">{STATUS_LABEL[q.status]}</b></p><p>Issue date: <b className="text-slate-900">{fmtLong(q.issueDate)}</b></p>{q.validUntil && <p>Valid until: <b className="text-slate-900">{fmtLong(q.validUntil)}</b> ({daysBetween(q.issueDate, q.validUntil)} days)</p>}</div>
      </header>
      <section className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
        <p><span className="text-slate-500">Project:</span> <b>{q.project.name}</b> (#{q.project.number})</p>
        <p><span className="text-slate-500">Customer:</span> <b>{q.project.customer}</b></p>
        <p><span className="text-slate-500">Section:</span> {q.section ?? "—"}</p>
        <p><span className="text-slate-500">Prepared by:</span> {q.preparedBy ?? "—"}{q.approvedBy ? ` · Approved by ${q.approvedBy}` : ""}</p>
      </section>
      <table className="w-full border-collapse text-xs">
        <thead><tr className="bg-slate-800 text-white"><th className="p-2 text-left">#</th><th className="p-2 text-left">Item Description</th><th className="p-2 text-left">Material</th><th className="p-2 text-right">Qty</th><th className="p-2 text-left">Unit</th><th className="p-2 text-right">Unit Rate ({q.currency})</th><th className="p-2 text-right">Total ({q.currency})</th></tr></thead>
        <tbody>
          {(["SUPPLY", "INSTALL"] as const).map((type) => {
            const list = q.items.filter((i) => i.type === type);
            if (!list.length) return null;
            return [
              <tr key={`h-${type}`} className="bg-slate-100"><td colSpan={7} className="p-2 font-semibold">{TYPE_LABEL[type]}</td></tr>,
              ...list.map((i, k) => <tr key={i.id} className="border-b border-slate-200"><td className="p-2">{k + 1}</td><td className="p-2">{i.description}</td><td className="p-2">{i.material ?? ""}</td><td className="p-2 text-right tabular-nums">{i.qty.toLocaleString("en-US")}</td><td className="p-2">{i.unit}</td><td className="p-2 text-right tabular-nums">{f(i.unitRate)}</td><td className="p-2 text-right tabular-nums">{f(i.total)}</td></tr>),
            ];
          })}
        </tbody>
        <tfoot>
          <tr><td colSpan={6} className="p-2 text-right text-slate-600">Total Supply</td><td className="p-2 text-right tabular-nums">{f(t.supply)}</td></tr>
          <tr><td colSpan={6} className="p-2 text-right text-slate-600">Total Dismantle & Install</td><td className="p-2 text-right tabular-nums">{f(t.install)}</td></tr>
          <tr className="border-t-2 border-slate-800 text-sm font-semibold"><td colSpan={6} className="p-2 text-right">Grand Total ({q.currency})</td><td className="p-2 text-right tabular-nums">{f(t.grand)}</td></tr>
        </tfoot>
      </table>
      {q.terms && <section><h2 className="mb-1 text-sm font-semibold">Terms & Conditions</h2><p className="whitespace-pre-wrap leading-relaxed text-slate-700">{q.terms}</p></section>}
      {q.notes && <p className="text-xs text-slate-500">Note: {q.notes}</p>}
    </div>
  );
}
