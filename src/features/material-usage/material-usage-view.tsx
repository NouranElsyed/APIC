"use client";
import * as React from "react";
import Link from "next/link";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, ArrowDownToLine, BarChart3, Boxes, CheckCircle2, FileSpreadsheet, FileText, ListChecks, Recycle, Scale, TrendingUp, Zap, Layers, PieChart as PieIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { scheduleStatus } from "@/features/reports/project-report";
import { ProjectStrip } from "@/features/reports/project-strip";
import { buildUsage, DEFAULT_PRICES, DEFAULT_TARGET_PCT, parsePrice, topUsage } from "./usage";
import type { MaterialUsageData } from "@/server/services/material-usage.service";

const BLUE = "#2563eb", GREEN = "#16a34a", GREY = "#e2e8f0";
const STORAGE_KEY = "materialUsage.prices";

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const tons = (kg: number) => (kg / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const pct = (n: number) => `${n.toFixed(1)}%`;
const axisMoney = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(v));

export function MaterialUsageView({ data, tabs, canCost }: { data: MaterialUsageData; tabs: React.ReactNode; canCost: boolean }) {
  const { project: p, currency } = data;
  const status = scheduleStatus(data.kpis ? { ...data.kpis } : null);

  // Prices are inputs (the system does not keep material prices per project); remembered per browser.
  const [cost, setCost] = React.useState(String(DEFAULT_PRICES.costPerKg));
  const [scrap, setScrap] = React.useState(String(DEFAULT_PRICES.scrapPerKg));
  const [target, setTarget] = React.useState(String(DEFAULT_TARGET_PCT));
  React.useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (saved && typeof saved === "object") {
        if (saved.cost != null) setCost(String(parsePrice(saved.cost, DEFAULT_PRICES.costPerKg)));
        if (saved.scrap != null) setScrap(String(parsePrice(saved.scrap, DEFAULT_PRICES.scrapPerKg)));
        if (saved.target != null) setTarget(String(parsePrice(saved.target, DEFAULT_TARGET_PCT)));
      }
    } catch { /* private mode / bad JSON: keep the defaults */ }
  }, []);
  React.useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ cost, scrap, target })); } catch { /* ignore */ }
  }, [cost, scrap, target]);

  const prices = { costPerKg: parsePrice(cost, DEFAULT_PRICES.costPerKg), scrapPerKg: parsePrice(scrap, DEFAULT_PRICES.scrapPerKg) };
  const targetPct = parsePrice(target, DEFAULT_TARGET_PCT);
  const { rows, totals } = React.useMemo(() => buildUsage(data.parts, prices), [data.parts, prices.costPerKg, prices.scrapPerKg]); // eslint-disable-line react-hooks/exhaustive-deps
  const bars = React.useMemo(() => topUsage(rows, 5), [rows]);

  const hasData = totals.parts > 0;
  const usedShare = totals.purchaseKg > 0 ? (totals.usedKg / totals.purchaseKg) * 100 : 0;
  const q = `costPerKg=${prices.costPerKg}&scrapPerKg=${prices.scrapPerKg}`;
  const id = p.id;
  const onTarget = totals.scrapPct <= targetPct;

  return (
    <div className="space-y-5">
      <ProjectStrip name={p.name} number={p.number} startDate={p.startDate} endDate={p.endDate} status={status} />
      {tabs}

      {/* prices */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <Field label={`Material price (${currency}/kg)`} value={cost} onChange={setCost} />
          <Field label={`Scrap resale (${currency}/kg)`} value={scrap} onChange={setScrap} />
          <Field label="Scrap target (%)" value={target} onChange={setTarget} />
          <p className="min-w-[220px] flex-1 text-xs text-muted-foreground">Costs are calculated from these rates and the weights in Standard Calculations. They are saved in this browser only.</p>
        </CardContent>
      </Card>

      {!hasData ? (
        <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <AlertCircle className="h-5 w-5" />
          <p>No parts in Standard Calculations for this project yet.</p>
          <Link href="/takeoff" className="font-medium text-primary hover:underline">Open Nesting &amp; Costing</Link>
        </CardContent></Card>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<Layers className="h-5 w-5 text-primary" />} tint="bg-primary/10" label="Total Material Cost" value={`${currency} ${money(totals.purchaseCost)}`} note={totals.trackedParts < totals.parts ? `${totals.trackedParts} of ${totals.parts} parts have a purchase weight` : "Based on purchased weight"} />
            <Kpi icon={<Scale className="h-5 w-5 text-primary" />} tint="bg-primary/10" label="Total Used Weight" value={`${tons(totals.usedKg)} Ton`} note={`${Math.round(usedShare)}% of ${tons(totals.purchaseKg)} T purchased`} />
            <Kpi icon={<Recycle className="h-5 w-5 text-green-600" />} tint="bg-green-500/10" label="Total Scrap Value" value={`${currency} ${money(totals.scrapValue)}`} note={`${tons(totals.scrapKg)} T of scrap`} />
            <Kpi icon={<PieIcon className="h-5 w-5 text-primary" />} tint="bg-primary/10" label="Material Loss" value={pct(totals.scrapPct)} valueClass={onTarget ? undefined : "text-red-600"}
              note={<span className="inline-flex items-center gap-1">vs. {targetPct}% Target {onTarget ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600" /> : <AlertCircle className="h-3.5 w-3.5 text-red-600" />}</span>} />
          </div>

          {/* charts */}
          <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr_1fr]">
            <Panel icon={<Boxes className="h-4 w-4 text-primary" />} title="Material Usage Overview">
              <div className="flex items-center gap-4">
                <div className="relative h-44 w-44 shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={[{ name: "Used", value: totals.usedKg, c: BLUE }, { name: "Scrap", value: totals.scrapKg, c: GREEN }, ...(totals.purchaseKg <= 0 ? [{ name: "-", value: 1, c: GREY }] : [])]} dataKey="value" innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                        {[BLUE, GREEN, GREY].map((c) => <Cell key={c} fill={c} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-2xl font-bold">{Math.round(usedShare)}%</p><p className="text-xs text-muted-foreground">Used</p></div>
                </div>
                <ul className="min-w-0 flex-1 space-y-3 text-sm">
                  <Legend color={BLUE} label="Used" value={`${tons(totals.usedKg)} Ton`} />
                  <Legend color={GREEN} label="Scrap" value={`${tons(totals.scrapKg)} Ton`} />
                  <Legend color={GREY} label="Purchased" value={`${tons(totals.purchaseKg)} Ton`} />
                </ul>
              </div>
            </Panel>

            <Panel icon={<BarChart3 className="h-4 w-4 text-primary" />} title="Usage by Material">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bars} margin={{ top: 22, right: 8, bottom: 0, left: -14 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" interval={0} tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}…` : v)} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v) => [`${Number(v).toFixed(1)} T`, "Used"]} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                    <Bar dataKey="tons" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false} label={{ position: "top", fontSize: 11, formatter: (v: unknown) => `${Number(v).toFixed(1)}T` }} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel icon={<TrendingUp className="h-4 w-4 text-primary" />} title="Cost Trend" action={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BLUE }} />Purchase orders (cumulative)</span>}>
              {data.orderTrend.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data.orderTrend} margin={{ top: 12, right: 12, bottom: 0, left: -6 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                      <YAxis tickFormatter={axisMoney} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={48} />
                      <Tooltip formatter={(v) => [`${currency} ${money(Number(v))}`, "Ordered"]} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                      <Area dataKey="value" type="monotone" stroke={BLUE} strokeWidth={2.5} fill={BLUE} fillOpacity={0.1} dot={{ r: 3 }} isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-56 flex-col items-center justify-center gap-1 px-4 text-center text-xs text-muted-foreground">
                  <p>No priced purchase orders yet.</p>
                  <Link href={`/projects/${id}/planning`} className="font-medium text-primary hover:underline">Add orders in Planning › Materials</Link>
                </div>
              )}
            </Panel>
          </div>

          {/* details + actions */}
          <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
            <Panel icon={<ListChecks className="h-4 w-4 text-primary" />} title="Material Details">
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      <Th left>Material</Th><Th left>Standard</Th><Th>Used Qty</Th><Th left>Unit</Th><Th>Purchase Qty</Th><Th>Scrap %</Th>
                      <Th>Used Cost ({currency})</Th><Th>Scrap Value ({currency})</Th><Th>Loss %</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                      <tr key={r.key} className="hover:bg-muted/30">
                        <td className="px-3 py-2.5 font-medium">{r.name}</td>
                        <td className="px-3 py-2.5 text-muted-foreground">{r.standard}</td>
                        <Td>{tons(r.usedKg)}</Td><td className="px-3 py-2.5 text-muted-foreground">Ton</td><Td>{tons(r.purchaseKg)}</Td>
                        <Td>{pct(r.scrapPct)}</Td><Td>{money(r.usedCost)}</Td><Td>{money(r.scrapValue)}</Td><Td>{pct(r.lossPct)}</Td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-primary/10 font-semibold">
                      <td className="px-3 py-2.5">Total</td><td />
                      <Td>{tons(totals.usedKg)}</Td><td className="px-3 py-2.5">Ton</td><Td>{tons(totals.purchaseKg)}</Td>
                      <Td>{pct(totals.scrapPct)}</Td><Td>{money(totals.usedCost)}</Td><Td>{money(totals.scrapValue)}</Td><Td>{pct(totals.lossPct)}</Td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                Used = net part weight. Purchase = stock weight entered per part (parts without one count as no scrap). Scrap % = scrap ÷ purchase weight. Loss % = money lost on scrap after reselling it, as a share of the purchase cost.
              </p>
            </Panel>

            <Panel icon={<Zap className="h-4 w-4 text-primary" />} title="Quick Actions">
              <div className="space-y-2">
                <Action icon={<FileSpreadsheet className="h-4 w-4 text-green-600" />} label="Export to Excel" href={`/api/projects/${id}/material-usage/export?${q}&target=${targetPct}`} />
                <Action icon={<FileText className="h-4 w-4 text-red-600" />} label="Export to PDF" href={`/print/projects/${id}/material-usage?${q}&target=${targetPct}`} newTab />
                {canCost && <Action icon={<ArrowDownToLine className="h-4 w-4 text-primary" />} label="Download BOQ Report" href={`/api/projects/${id}/quotations/export`} />}
                <Action icon={<Recycle className="h-4 w-4 text-green-600" />} label="View Scrap Report" href="/takeoff" />
              </div>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} step="any" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="w-40" />
    </div>
  );
}

function Kpi({ icon, tint, label, value, valueClass, note }: { icon: React.ReactNode; tint: string; label: string; value: string; valueClass?: string; note?: React.ReactNode }) {
  return (
    <Card><CardContent className="flex items-start gap-3 p-4">
      <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tint)}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("truncate text-xl font-semibold tracking-tight", valueClass)}>{value}</p>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
    </CardContent></Card>
  );
}

function Panel({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3"><CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle>{action}</CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: string }) {
  return <li className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} /><div><p className="font-medium leading-tight">{label}</p><p className="text-xs text-muted-foreground">{value}</p></div></li>;
}

const Th = ({ children, left }: { children: React.ReactNode; left?: boolean }) => <th className={cn("px-3 py-2.5 font-semibold", left ? "text-left" : "text-right")}>{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td className="px-3 py-2.5 text-right tabular-nums">{children}</td>;

function Action({ icon, label, href, newTab }: { icon: React.ReactNode; label: string; href: string; newTab?: boolean }) {
  return (
    <a href={href} {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50">
      {icon}{label}
    </a>
  );
}

