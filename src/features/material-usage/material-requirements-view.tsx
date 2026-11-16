"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Boxes, Building2, CheckCircle2, ChevronLeft, ChevronRight, Download, Layers, ListChecks, Search, ShoppingCart, Truck } from "lucide-react";
import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PurchaseRequestDialog } from "./purchase-request-dialog";
import { toast } from "sonner";
import { STATUS_LABEL, summarize, type ReqRow, type ReqStatus } from "./requirements";
import type { MaterialRequirementsData } from "@/server/services/material-usage.service";

const PAGE = 8;
const FILTERS = ["All", "Plate", "Pipe", "Profile", "Flat"] as const;
const FILTER_LABEL: Record<string, string> = { All: "All", Plate: "Plates", Pipe: "Pipes", Profile: "Profiles", Flat: "Bars & Flats" };
const TONE: Record<ReqStatus, string> = {
  AVAILABLE: "bg-green-100 text-green-700", SHORTAGE: "bg-amber-100 text-amber-700", TO_ORDER: "bg-blue-100 text-blue-700", ORDERED: "bg-violet-100 text-violet-700",
};
const COLOR: Record<ReqStatus, string> = { AVAILABLE: "#2563eb", SHORTAGE: "#f59e0b", TO_ORDER: "#93c5fd", ORDERED: "#8b5cf6" };
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const unitLabel = (u: string) => (u.toLowerCase() === "sheet" ? "sheets" : u);

export function MaterialRequirementsView({ data, canOrder }: { data: MaterialRequirementsData; canOrder: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("All");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [selId, setSelId] = React.useState<string | null>(null);
  const [onlyMissing, setOnlyMissing] = React.useState(false);
  // purchase request: all missing lines, or just the one picked in Material Details
  const [poRows, setPoRows] = React.useState<ReqRow[] | null>(null);
  const orderable = React.useMemo(() => data.rows.filter((r) => r.materialId && r.toOrder > 0), [data.rows]);
  const startPo = (rows: ReqRow[]) => {
    const ok = rows.filter((r) => r.materialId && r.toOrder > 0);
    if (ok.length) return setPoRows(ok);
    toast.info(data.source === "PART_LIST" ? "Use Send to Materials in Nesting & Costing first, so these needs become orderable lines." : "Nothing is left to order — everything is available or already on order.");
  };

  const sum = React.useMemo(() => summarize(data.rows), [data.rows]);
  const shown = React.useMemo(() => {
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => (filter === "All" || r.type === filter) && (!onlyMissing || r.shortage > 0) && (!s || `${r.spec} ${r.grade} ${r.standard} ${r.type}`.toLowerCase().includes(s)));
  }, [data.rows, filter, q, onlyMissing]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages);
  const pageRows = shown.slice((cur - 1) * PAGE, cur * PAGE);
  const sel = data.rows.find((r) => r.id === selId) ?? shown[0] ?? null;
  const pctOf = (n: number) => (sum.total ? Math.round((n / sum.total) * 100) : 0);

  const exportCsv = () => {
    const head = ["#", "Type", "Specification", "Grade", "Standard", "Required", "Unit", "Required weight (kg)", "Available", "Shortage", "Status"];
    const lines = data.rows.map((r, i) => [i + 1, r.type, r.spec, r.grade, r.standard, r.required, r.unit, r.weightKg ?? "", r.available, r.shortage, STATUS_LABEL[r.status]]);
    const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = `raw-material-requirements-${data.project.number}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10"><Boxes className="h-6 w-6 text-primary" /></div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Raw Material Requirements</h1>
            <p className="text-sm text-muted-foreground">Material Procurement &amp; Availability for Project: {data.project.name}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <select value={data.project.id} onChange={(e) => router.push(`/projects/${e.target.value}/material-usage`)} className="max-w-[240px] bg-transparent text-sm font-medium outline-none">
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <button onClick={exportCsv} disabled={!data.rows.length} className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted/50 disabled:opacity-50"><Download className="h-4 w-4 text-primary" />Export Report</button>
          {canOrder && <button onClick={() => startPo(orderable)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"><ShoppingCart className="h-4 w-4" />Create Purchase Request{orderable.length > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs">{orderable.length}</span>}</button>}
        </div>
      </div>

      {!data.rows.length ? (
        <Card><CardContent className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
          <AlertTriangle className="h-5 w-5" />
          <p>No raw material requirements for this project yet.</p>
          <p className="text-xs">Add parts in Nesting &amp; Costing, then use <b>Send to Materials</b> after nesting.</p>
          <Link href="/takeoff" className="font-medium text-primary hover:underline">Open Nesting &amp; Costing</Link>
        </CardContent></Card>
      ) : (
        <>
          {data.source === "PART_LIST" && (
            <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800">
              These needs are worked out from the Part List (weights, in kg). Nest the plates and use <b>Send to Materials</b> to get exact sheet sizes and counts.
            </p>
          )}
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={<Layers className="h-6 w-6 text-primary" />} tint="bg-primary/10" value={sum.total} label="Material Items" />
            <Kpi icon={<CheckCircle2 className="h-6 w-6 text-green-600" />} tint="bg-green-500/10" value={sum.AVAILABLE} label="Available" pct={pctOf(sum.AVAILABLE)} />
            <Kpi icon={<AlertTriangle className="h-6 w-6 text-amber-500" />} tint="bg-amber-500/10" value={sum.SHORTAGE} label="Shortage" pct={pctOf(sum.SHORTAGE)} />
            <Kpi icon={<ShoppingCart className="h-6 w-6 text-primary" />} tint="bg-primary/10" value={sum.TO_ORDER + sum.ORDERED} label="To Order / On Order" pct={pctOf(sum.TO_ORDER + sum.ORDERED)} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            {/* list */}
            <Card>
              <CardHeader className="space-y-3 pb-3">
                <CardTitle className="flex items-center gap-2 text-base"><ListChecks className="h-4 w-4 text-primary" />Material Requirements List<span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{data.rows.length} Items</span></CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[220px] flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search material, grade, dimensions..." className="pl-9" />
                  </div>
                  <button onClick={() => { setOnlyMissing((v) => !v); setPage(1); }} className={cn("rounded-lg border px-3 py-2 text-sm font-medium", onlyMissing ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted/50")}>Only missing</button>
                  {FILTERS.map((f) => (
                    <button key={f} onClick={() => { setFilter(f); setPage(1); }} className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium", filter === f ? "bg-primary text-primary-foreground" : "bg-muted/60 hover:bg-muted")}>{FILTER_LABEL[f]}</button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr><Th left>#</Th><Th left>Material Type</Th><Th left>Specification</Th><Th left>Grade / Standard</Th><Th>Required Qty</Th><Th left>Unit</Th><Th>Required Weight</Th><Th>Available</Th><Th>Shortage</Th><Th left>Status</Th></tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {pageRows.map((r, i) => (
                        <tr key={r.id} onClick={() => setSelId(r.id)} className={cn("cursor-pointer hover:bg-muted/30", sel?.id === r.id && "bg-primary/5")}>
                          <td className="px-3 py-2.5 text-muted-foreground">{(cur - 1) * PAGE + i + 1}</td>
                          <td className="px-3 py-2.5">{r.type}</td>
                          <td className="px-3 py-2.5 font-medium">{r.spec}</td>
                          <td className="px-3 py-2.5 leading-tight"><span className="font-medium">{r.grade}</span><br /><span className="text-xs text-muted-foreground">{r.standard}</span></td>
                          <Td>{num(r.required)}</Td><td className="px-3 py-2.5 text-muted-foreground">{unitLabel(r.unit)}</td>
                          <Td>{r.weightKg != null ? `${num(r.weightKg)} kg` : "—"}</Td><Td>{num(r.available)}</Td>
                          <td className={cn("px-3 py-2.5 text-right tabular-nums", r.shortage > 0 && "font-semibold text-red-600")}>{num(r.shortage)}</td>
                          <td className="px-3 py-2.5"><span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", TONE[r.status])}>{STATUS_LABEL[r.status]}</span></td>
                        </tr>
                      ))}
                      {!pageRows.length && <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">Nothing matches the filter.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Showing {shown.length ? (cur - 1) * PAGE + 1 : 0}–{Math.min(cur * PAGE, shown.length)} of {shown.length} items</span>
                  <div className="flex items-center gap-1">
                    <button disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="rounded-md border border-border p-1.5 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
                    <span className="px-2">{cur} / {pages}</span>
                    <button disabled={cur >= pages} onClick={() => setPage(cur + 1)} className="rounded-md border border-border p-1.5 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* details */}
            <div className="space-y-4">
              {sel && <Details r={sel} projectId={data.project.id} canOrder={canOrder} onOrder={() => startPo([sel])} />}
            </div>
          </div>

          {/* overview + workflow */}
          <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="text-base">Material Overview</CardTitle></CardHeader>
              <CardContent className="grid items-center gap-4 sm:grid-cols-[170px_1fr]">
                <div className="relative mx-auto h-40 w-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={(Object.keys(COLOR) as ReqStatus[]).map((k) => ({ name: k, value: sum[k] })).filter((d) => d.value > 0)} dataKey="value" innerRadius="66%" outerRadius="100%" stroke="none" isAnimationActive={false}>
                        {(Object.keys(COLOR) as ReqStatus[]).filter((k) => sum[k] > 0).map((k) => <Cell key={k} fill={COLOR[k]} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><p className="text-2xl font-bold">{sum.total}</p><p className="text-xs text-muted-foreground">Total Items</p></div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <ul className="space-y-2 text-sm">
                    {(Object.keys(COLOR) as ReqStatus[]).map((k) => <li key={k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COLOR[k] }} /><span className="font-medium">{STATUS_LABEL[k]}</span><span className="text-muted-foreground">{sum[k]} ({pctOf(sum[k])}%)</span></li>)}
                  </ul>
                  <div>
                    <p className="mb-2 text-sm font-semibold">By Material Type</p>
                    <ul className="space-y-2">
                      {Object.entries(sum.types).map(([t, n]) => (
                        <li key={t} className="flex items-center gap-2 text-xs"><span className="w-14 shrink-0">{t}</span><span className="h-2 flex-1 overflow-hidden rounded bg-muted"><span className="block h-full rounded bg-primary" style={{ width: `${pctOf(n)}%` }} /></span><span className="w-9 text-right tabular-nums">{pctOf(n)}%</span></li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Truck className="h-4 w-4 text-primary" />Procurement Workflow</CardTitle></CardHeader>
              <CardContent>
                <ol className="grid grid-cols-2 gap-2 text-center text-xs font-medium sm:grid-cols-5">
                  {[["Projects & Engineering Drawings", "/projects"], ["Material Takeoff", "/takeoff"], ["Stock Check", "/procurement"], ["Procurement", "/procurement"], ["Ready for Production", `/projects/${data.project.id}/production`]].map(([l, href], i) => (
                    <li key={l}><Link href={href} className={cn("flex h-full items-center justify-center rounded-lg border border-border p-3 hover:bg-muted/50", i === 4 && "border-green-500/40 bg-green-500/10 text-green-700")}>{l}</Link></li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          </div>
        </>
      )}
      {poRows && <PurchaseRequestDialog open onOpenChange={(v) => !v && setPoRows(null)} rows={poRows} suppliers={data.suppliers} currency={data.currency} projectId={data.project.id} />}
    </div>
  );
}

function Details({ r, projectId, canOrder, onOrder }: { r: ReqRow; projectId: string; canOrder: boolean; onOrder: () => void }) {
  const dims: [string, string | null][] = [
    ["Material Grade", r.grade], ["Standard", r.standard],
    ["Thickness", r.thicknessMm != null ? `${r.thicknessMm} mm` : null], ["Width", r.widthMm != null ? `${r.widthMm} mm` : null], ["Length", r.lengthMm != null ? `${r.lengthMm} mm` : null],
  ];
  const u = unitLabel(r.unit);
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">Material Details</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"><Layers className="h-5 w-5 text-primary" /></div><div className="min-w-0 flex-1"><p className="truncate font-semibold">{r.spec}</p></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{r.type}</span></div>
        <dl className="space-y-1.5 text-sm">{dims.filter(([, v]) => v).map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}:</dt><dd className="font-medium">{v}</dd></div>)}</dl>
        <div className="border-t border-border pt-3">
          <p className="mb-2 text-sm font-semibold">Stock &amp; Procurement</p>
          <dl className="space-y-1.5 text-sm">
            <Line label="Required" value={`${num(r.required)} ${u}`} />
            <Line label="Available" value={`${num(r.available)} ${u}`} />
            {r.ordered > 0 && <Line label="On order" value={`${num(r.ordered)} ${u}`} />}
            <Line label="Shortage" value={`${num(r.shortage)} ${u}`} red={r.shortage > 0} />
          </dl>
        </div>
        {r.notes && <p className="rounded-md bg-muted/50 p-2 text-[11px] leading-snug text-muted-foreground">{r.notes}</p>}
        {canOrder && r.shortage > 0 && <button onClick={onOrder} className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"><ShoppingCart className="h-4 w-4" />Create Purchase Request</button>}
        <div className="space-y-1.5 border-t border-border pt-3 text-xs">
          <p className="font-semibold">Related Information</p>
          <Link href="/takeoff" className="block text-primary hover:underline">View Part List &amp; Nesting</Link>
          <Link href="/procurement" className="block text-primary hover:underline">Check Stock Inventory</Link>
          <Link href={`/projects/${projectId}/planning`} className="block text-primary hover:underline">Planning › Materials (orders)</Link>
          <a href={`/api/projects/${projectId}/quotations/export`} className="block text-primary hover:underline">Download BoQ</a>
        </div>
      </CardContent>
    </Card>
  );
}

const Line = ({ label, value, red }: { label: string; value: string; red?: boolean }) => <div className={cn("flex justify-between gap-3", red && "text-red-600")}><dt className={red ? "" : "text-muted-foreground"}>{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>;
const Th = ({ children, left }: { children: React.ReactNode; left?: boolean }) => <th className={cn("px-3 py-2.5 font-semibold", left ? "text-left" : "text-right")}>{children}</th>;
const Td = ({ children }: { children: React.ReactNode }) => <td className="px-3 py-2.5 text-right tabular-nums">{children}</td>;
function Kpi({ icon, tint, value, label, pct }: { icon: React.ReactNode; tint: string; value: number; label: string; pct?: number }) {
  return <Card><CardContent className="flex items-center gap-4 p-4"><div className={cn("flex h-14 w-14 shrink-0 items-center justify-center rounded-full", tint)}>{icon}</div><div><p className="text-3xl font-semibold leading-none">{value}</p><p className="mt-1 text-sm text-muted-foreground">{label}{pct != null && <span className="ml-1.5 text-xs">({pct}%)</span>}</p></div></CardContent></Card>;
}
