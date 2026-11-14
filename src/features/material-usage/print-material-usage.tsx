"use client";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Prices, UsageRow, UsageTotals } from "./usage";

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const tons = (kg: number) => (kg / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (n: number) => `${n.toFixed(1)}%`;

/** Print-friendly Material & Usage table; use the browser's "Save as PDF". */
export function PrintMaterialUsage({ title, currency, prices, targetPct, rows, totals }: { title: string; currency: string; prices: Prices; targetPct: number; rows: UsageRow[]; totals: UsageTotals }) {
  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-6 print:p-0">
      <style>{`@page { size: A4 landscape; margin: 12mm; } @media print { .no-print { display: none !important; } body { background: #fff; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="no-print flex justify-end"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Button></div>
      <div className="border-b border-border pb-3">
        <h1 className="text-xl font-semibold">Material &amp; Usage — {title}</h1>
        <p className="text-sm text-muted-foreground">Material {currency} {prices.costPerKg}/kg · Scrap resale {currency} {prices.scrapPerKg}/kg · Scrap target {targetPct}%</p>
      </div>
      <div className="grid grid-cols-4 gap-3 text-sm">
        <Stat label="Total Material Cost" value={`${currency} ${money(totals.purchaseCost)}`} />
        <Stat label="Total Used Weight" value={`${tons(totals.usedKg)} Ton`} />
        <Stat label="Total Scrap Value" value={`${currency} ${money(totals.scrapValue)}`} />
        <Stat label="Material Loss" value={`${pct(totals.scrapPct)} (target ${targetPct}%)`} />
      </div>
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs">
          <tr>{["Material", "Standard", "Used Qty", "Unit", "Purchase Qty", "Scrap %", `Used Cost (${currency})`, `Scrap Value (${currency})`, "Loss %"].map((h, i) => <th key={h} className={`px-2 py-2 font-semibold ${i < 2 || i === 3 ? "text-left" : "text-right"}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.key}><td className="px-2 py-1.5 font-medium">{r.name}</td><td className="px-2 py-1.5">{r.standard}</td><R>{tons(r.usedKg)}</R><td className="px-2 py-1.5">Ton</td><R>{tons(r.purchaseKg)}</R><R>{pct(r.scrapPct)}</R><R>{money(r.usedCost)}</R><R>{money(r.scrapValue)}</R><R>{pct(r.lossPct)}</R></tr>
          ))}
        </tbody>
        <tfoot><tr className="bg-blue-50 font-semibold"><td className="px-2 py-2">Total</td><td /><R>{tons(totals.usedKg)}</R><td className="px-2 py-2">Ton</td><R>{tons(totals.purchaseKg)}</R><R>{pct(totals.scrapPct)}</R><R>{money(totals.usedCost)}</R><R>{money(totals.scrapValue)}</R><R>{pct(totals.lossPct)}</R></tr></tfoot>
      </table>
      <p className="text-[11px] text-muted-foreground">Used = net part weight. Purchase = stock weight entered per part (parts without one count as no scrap). Loss % = money lost on scrap after resale ÷ purchase cost.</p>
    </div>
  );
}

const R = ({ children }: { children: React.ReactNode }) => <td className="px-2 py-1.5 text-right tabular-nums">{children}</td>;
const Stat = ({ label, value }: { label: string; value: string }) => <div className="rounded-lg border border-border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="font-semibold">{value}</p></div>;
