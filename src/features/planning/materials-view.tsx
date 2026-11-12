"use client";
import * as React from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, Download, FileSpreadsheet, PackageCheck, PackageX, Plus, Search, Truck, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { fmtLong, fmtShort } from "./gantt-chart";
import { ImportMaterialsDialog, MaterialDialog, OrderDialog, ReceiveDialog } from "./material-dialogs";
import type { MaterialDTO, MaterialStatus, OrderDTO } from "./materials";
import type { MaterialsData } from "@/server/services/materials.service";

// Full class strings so Tailwind keeps them.
const STATUS: Record<MaterialStatus, { label: string; chip: string; bar: string }> = {
  NOT_ORDERED: { label: "Not ordered", chip: "bg-red-50 text-red-700", bar: "bg-red-400" },
  ORDERED: { label: "Ordered", chip: "bg-blue-50 text-blue-700", bar: "bg-blue-500" },
  PARTIAL: { label: "Partially delivered", chip: "bg-amber-50 text-amber-700", bar: "bg-amber-500" },
  DELIVERED: { label: "Delivered", chip: "bg-green-50 text-green-700", bar: "bg-green-600" },
  LATE: { label: "Late", chip: "bg-red-100 text-red-800", bar: "bg-red-600" },
};
const fmtQty = (n: number) => (Math.round(n * 1000) / 1000).toLocaleString("en-US", { maximumFractionDigits: 3 });
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

function DueChip({ m }: { m: MaterialDTO }) {
  if (!m.neededBy) return <span className="text-xs text-muted-foreground">—</span>;
  const d = m.daysToNeeded ?? 0;
  const done = m.status === "DELIVERED";
  const tone = done ? "text-muted-foreground" : d < 0 ? "text-red-600" : d <= 14 ? "text-amber-600" : "text-muted-foreground";
  return (
    <div className="leading-tight">
      <p className="text-xs font-medium tabular-nums">{fmtShort(m.neededBy)}{m.neededBySource === "activity" && <span className="ml-1 text-[10px] font-normal text-muted-foreground" title="From the linked activity's start date">· {m.activityCode}</span>}</p>
      {!done && <p className={cn("text-[11px]", tone)}>{d < 0 ? `${-d}d overdue` : d === 0 ? "today" : `in ${d}d`}</p>}
    </div>
  );
}

export function MaterialsView({ projectId, data, canEdit }: { projectId: string; data: MaterialsData; canEdit: boolean }) {
  const [q, setQ] = React.useState("");
  const [phase, setPhase] = React.useState("");
  const [status, setStatus] = React.useState<"" | MaterialStatus | "URGENT">("");
  const [supplier, setSupplier] = React.useState("");
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  const [materialDlg, setMaterialDlg] = React.useState<{ open: boolean; material: MaterialDTO | null }>({ open: false, material: null });
  const [orderDlg, setOrderDlg] = React.useState<{ open: boolean; material: MaterialDTO | null; order: OrderDTO | null }>({ open: false, material: null, order: null });
  const [receiveDlg, setReceiveDlg] = React.useState<{ open: boolean; material: MaterialDTO | null; order: OrderDTO | null }>({ open: false, material: null, order: null });
  const [importOpen, setImportOpen] = React.useState(false);
  const s = data.summary;
  const base = `/api/projects/${projectId}/materials`;

  const filtered = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    return data.items.filter((m) =>
      (!term || [m.description, m.spec, m.code, m.activityCode, ...m.suppliers, ...m.orders.map((o) => o.poNumber)].some((x) => x && x.toLowerCase().includes(term))) &&
      (!phase || (phase === "__none" ? !m.wbsId : m.wbsId === phase)) &&
      (!status || (status === "URGENT" ? m.urgent : m.status === status)) &&
      (!supplier || m.suppliers.includes(supplier)));
  }, [data.items, q, phase, status, supplier]);

  const groups = React.useMemo(() => {
    const map = new Map<string, MaterialDTO[]>();
    for (const m of filtered) { const k = m.phase ?? "No phase"; (map.get(k) ?? map.set(k, []).get(k)!).push(m); }
    return [...map.entries()];
  }, [filtered]);

  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const filtersOn = q || phase || status || supplier;

  return (
    <div className="space-y-5">
      {/* ---- KPI cards ---- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Card><CardContent className="p-5"><p className="text-xs font-medium text-muted-foreground">Total items</p><p className="text-2xl font-semibold">{s.total}</p><p className="text-xs text-muted-foreground">{Math.round(s.percentDelivered)}% delivered overall</p></CardContent></Card>
        <button type="button" onClick={() => setStatus(status === "NOT_ORDERED" ? "" : "NOT_ORDERED")} className="text-left"><Card className={cn("h-full", status === "NOT_ORDERED" && "ring-2 ring-red-300")}><CardContent className="flex items-start justify-between p-5"><div><p className="text-xs font-medium text-muted-foreground">Not ordered yet</p><p className="text-2xl font-semibold text-red-600">{s.byStatus.NOT_ORDERED}</p><p className="text-xs text-muted-foreground">{s.urgent > 0 ? `${s.urgent} needed within 14 days` : "none urgent"}</p></div><PackageX className="h-5 w-5 text-red-500" /></CardContent></Card></button>
        <button type="button" onClick={() => setStatus(status === "ORDERED" ? "" : "ORDERED")} className="text-left"><Card className={cn("h-full", status === "ORDERED" && "ring-2 ring-blue-300")}><CardContent className="flex items-start justify-between p-5"><div><p className="text-xs font-medium text-muted-foreground">Ordered / on the way</p><p className="text-2xl font-semibold text-blue-600">{s.byStatus.ORDERED + s.byStatus.PARTIAL}</p><p className="text-xs text-muted-foreground">{s.byStatus.PARTIAL} partially delivered</p></div><Truck className="h-5 w-5 text-blue-500" /></CardContent></Card></button>
        <button type="button" onClick={() => setStatus(status === "DELIVERED" ? "" : "DELIVERED")} className="text-left"><Card className={cn("h-full", status === "DELIVERED" && "ring-2 ring-green-300")}><CardContent className="flex items-start justify-between p-5"><div><p className="text-xs font-medium text-muted-foreground">Delivered</p><p className="text-2xl font-semibold text-green-600">{s.byStatus.DELIVERED}</p><p className="text-xs text-muted-foreground">fully received</p></div><PackageCheck className="h-5 w-5 text-green-600" /></CardContent></Card></button>
        <button type="button" onClick={() => setStatus(status === "LATE" ? "" : "LATE")} className="text-left"><Card className={cn("h-full", status === "LATE" && "ring-2 ring-red-300")}><CardContent className="flex items-start justify-between p-5"><div><p className="text-xs font-medium text-muted-foreground">Late deliveries</p><p className={cn("text-2xl font-semibold", s.byStatus.LATE > 0 && "text-red-600")}>{s.byStatus.LATE}</p><p className="text-xs text-muted-foreground">{s.nextDue ? `next due ${fmtShort(s.nextDue.neededBy)}` : "past expected date"}</p></div><Clock className="h-5 w-5 text-red-500" /></CardContent></Card></button>
      </div>

      {s.total > 0 && (
        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader><CardTitle className="text-sm">Progress by phase</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {data.phases.map((p) => (
                <button key={p.phase} type="button" onClick={() => { const w = data.wbsOptions.find((x) => x.label === p.phase); setPhase(w ? (phase === w.id ? "" : w.id) : phase === "__none" ? "" : "__none"); }} className="block w-full text-left">
                  <div className="mb-1 flex items-center justify-between gap-3 text-xs"><span className="truncate font-medium">{p.phase}</span><span className="shrink-0 text-muted-foreground">{p.delivered}/{p.total} delivered{p.notOrdered > 0 && <span className="text-red-600"> · {p.notOrdered} not ordered</span>}{p.late > 0 && <span className="text-red-700"> · {p.late} late</span>}</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-green-600" style={{ width: `${p.percent}%` }} /></div>
                </button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Suppliers</CardTitle></CardHeader>
            <CardContent>
              {data.suppliers.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No purchase orders yet.</p> : (
                <ul className="space-y-2.5">
                  {data.suppliers.slice(0, 6).map((v) => (
                    <li key={v.supplier}>
                      <button type="button" onClick={() => setSupplier(supplier === v.supplier ? "" : v.supplier)} className={cn("flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-secondary", supplier === v.supplier && "bg-secondary")}>
                        <span className="min-w-0"><span className="block truncate font-medium">{v.supplier}</span><span className="text-xs text-muted-foreground">{v.orders} order{v.orders === 1 ? "" : "s"} · {v.items} item{v.items === 1 ? "" : "s"}{v.late > 0 && <span className="text-red-600"> · {v.late} late</span>}</span></span>
                        {v.value > 0 && <span className="shrink-0 text-xs font-semibold tabular-nums">{money(v.value)}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {s.orderedValue > 0 && <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Total ordered (priced orders): <b className="text-foreground">{money(s.orderedValue)}</b></p>}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ---- toolbar ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search material, spec, PO, supplier…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="h-9 rounded-lg border border-input bg-card px-2 text-sm shadow-sm" value={phase} onChange={(e) => setPhase(e.target.value)}>
          <option value="">All phases</option>{data.wbsOptions.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}<option value="__none">No phase</option>
        </select>
        <select className="h-9 rounded-lg border border-input bg-card px-2 text-sm shadow-sm" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="">All statuses</option>{(Object.keys(STATUS) as MaterialStatus[]).map((k) => <option key={k} value={k}>{STATUS[k].label}</option>)}<option value="URGENT">Urgent to order</option>
        </select>
        <select className="h-9 rounded-lg border border-input bg-card px-2 text-sm shadow-sm" value={supplier} onChange={(e) => setSupplier(e.target.value)}>
          <option value="">All suppliers</option>{data.supplierNames.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        {filtersOn && <Button variant="ghost" size="sm" onClick={() => { setQ(""); setPhase(""); setStatus(""); setSupplier(""); }}>Clear</Button>}
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && <Button size="sm" onClick={() => setMaterialDlg({ open: true, material: null })}><Plus className="h-4 w-4" /> Add material</Button>}
          {canEdit && <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import Excel</Button>}
          <Button size="sm" variant="outline" asChild><a href={`${base}/export`}><FileSpreadsheet className="h-4 w-4 text-green-600" /> Export</a></Button>
          {canEdit && <Button size="sm" variant="ghost" asChild><a href={`${base}/export?format=template`}><Download className="h-4 w-4" /> Template</a></Button>}
        </div>
      </div>

      {/* ---- list ---- */}
      {data.items.length === 0 ? (
        <EmptyState icon={<PackageCheck />} title="No materials tracked yet" description={canEdit ? "List what the project needs, per phase, then record who you buy it from and what has arrived. You can paste a whole BOQ with Import Excel." : undefined} />
      ) : filtered.length === 0 ? (
        <EmptyState icon={<Search />} title="Nothing matches these filters" />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-xs">
              <thead><tr className="border-b border-border bg-secondary text-left text-[11px] font-semibold text-muted-foreground">
                <th className="w-8 px-2 py-2" /><th className="px-3 py-2">Material</th><th className="px-3 py-2">Needed by</th>
                <th className="px-3 py-2 text-right">Required</th><th className="px-3 py-2 text-right">Ordered</th><th className="px-3 py-2">Received</th>
                <th className="px-3 py-2 text-right">To order</th><th className="px-3 py-2">Supplier</th><th className="px-3 py-2">Status</th><th className="w-24 px-3 py-2" />
              </tr></thead>
              <tbody>
                {groups.map(([name, list]) => (
                  <React.Fragment key={name}>
                    <tr className="border-b border-border bg-secondary/60"><td colSpan={10} className="px-3 py-2 text-xs font-semibold">{name} <span className="font-normal text-muted-foreground">· {list.length} item{list.length === 1 ? "" : "s"} · {list.filter((m) => m.status === "DELIVERED").length} delivered</span></td></tr>
                    {list.map((m) => {
                      const st = STATUS[m.status];
                      const expanded = open.has(m.id);
                      return (
                        <React.Fragment key={m.id}>
                          <tr className={cn("border-b border-border/60 hover:bg-secondary/30", m.urgent && "bg-red-50/40")}>
                            <td className="px-2 py-2"><button type="button" onClick={() => toggle(m.id)} className="text-muted-foreground hover:text-foreground" aria-label="Show orders">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</button></td>
                            <td className="px-3 py-2"><p className="font-medium">{m.description}{m.urgent && <span title="Needed soon and not fully ordered"><AlertTriangle className="ml-1 inline h-3.5 w-3.5 text-red-500" /></span>}</p><p className="text-[11px] text-muted-foreground">{[m.code, m.spec].filter(Boolean).join(" · ")}</p></td>
                            <td className="px-3 py-2"><DueChip m={m} /></td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtQty(m.requiredQty)} <span className="text-muted-foreground">{m.unit}</span></td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtQty(m.orderedQty)}</td>
                            <td className="px-3 py-2"><div className="flex items-center gap-2"><div className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary"><div className={cn("h-full rounded-full", st.bar)} style={{ width: `${m.percentReceived}%` }} /></div><span className="tabular-nums text-muted-foreground">{fmtQty(m.receivedQty)}</span></div></td>
                            <td className={cn("px-3 py-2 text-right tabular-nums", m.toOrder > 0 && "font-semibold text-red-600")}>{m.toOrder > 0 ? fmtQty(m.toOrder) : "—"}</td>
                            <td className="max-w-[180px] truncate px-3 py-2" title={m.suppliers.join(", ")}>{m.suppliers.length ? m.suppliers.join(", ") : <span className="text-muted-foreground">—</span>}</td>
                            <td className="px-3 py-2"><span className={cn("whitespace-nowrap rounded-md px-2 py-0.5 text-[11px] font-semibold", st.chip)}>{st.label}</span></td>
                            <td className="px-3 py-2 text-right">{canEdit && <button type="button" onClick={() => setMaterialDlg({ open: true, material: m })} className="text-primary hover:underline">Edit</button>}</td>
                          </tr>
                          {expanded && (
                            <tr className="border-b border-border/60 bg-card"><td /><td colSpan={9} className="px-3 py-3">
                              {m.orders.length === 0 ? <p className="text-xs text-muted-foreground">No purchase orders yet — {fmtQty(m.requiredQty)} {m.unit} still to be ordered.</p> : (
                                <table className="w-full text-xs">
                                  <thead><tr className="text-left text-[11px] text-muted-foreground"><th className="py-1 pr-3 font-medium">Supplier</th><th className="pr-3 font-medium">PO</th><th className="pr-3 text-right font-medium">Ordered</th><th className="pr-3 text-right font-medium">Price</th><th className="pr-3 font-medium">Ordered on</th><th className="pr-3 font-medium">Expected</th><th className="pr-3 text-right font-medium">Received</th><th className="pr-3 font-medium">Last received</th><th /></tr></thead>
                                  <tbody>
                                    {m.orders.map((o) => (
                                      <tr key={o.id} className="border-t border-border/50">
                                        <td className="py-1.5 pr-3 font-medium">{o.supplier}</td><td className="pr-3">{o.poNumber ?? "—"}</td>
                                        <td className="pr-3 text-right tabular-nums">{fmtQty(o.orderedQty)} {m.unit}</td>
                                        <td className="pr-3 text-right tabular-nums">{o.unitPrice != null ? money(o.unitPrice) : "—"}</td>
                                        <td className="pr-3">{o.orderDate ? fmtShort(o.orderDate) : "—"}</td>
                                        <td className={cn("pr-3", o.late && "font-semibold text-red-600")}>{o.expectedDate ? fmtShort(o.expectedDate) : "—"}{o.late && " · late"}</td>
                                        <td className="pr-3 text-right tabular-nums">{o.receivedQty >= o.orderedQty ? <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />{fmtQty(o.receivedQty)}</span> : fmtQty(o.receivedQty)}</td>
                                        <td className="pr-3">{o.receivedDate ? fmtLong(o.receivedDate) : "—"}</td>
                                        <td className="whitespace-nowrap py-1 text-right">{canEdit && <>
                                          {o.receivedQty < o.orderedQty && <button type="button" className="mr-3 font-medium text-green-700 hover:underline" onClick={() => setReceiveDlg({ open: true, material: m, order: o })}>Receive</button>}
                                          <button type="button" className="text-primary hover:underline" onClick={() => setOrderDlg({ open: true, material: m, order: o })}>Edit</button></>}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                              {canEdit && <Button size="sm" variant="outline" className="mt-2" onClick={() => setOrderDlg({ open: true, material: m, order: null })}><Plus className="h-4 w-4" /> Add purchase order</Button>}
                              {m.notes && <p className="mt-2 text-[11px] text-muted-foreground">Note: {m.notes}</p>}
                            </td></tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <MaterialDialog open={materialDlg.open} onOpenChange={(o) => setMaterialDlg((x) => ({ ...x, open: o }))} projectId={projectId} data={data} material={materialDlg.material} />
      {orderDlg.material && <OrderDialog open={orderDlg.open} onOpenChange={(o) => setOrderDlg((x) => ({ ...x, open: o }))} projectId={projectId} data={data} material={orderDlg.material} order={orderDlg.order} />}
      {receiveDlg.material && receiveDlg.order && <ReceiveDialog open={receiveDlg.open} onOpenChange={(o) => setReceiveDlg((x) => ({ ...x, open: o }))} projectId={projectId} material={receiveDlg.material} order={receiveDlg.order} />}
      <ImportMaterialsDialog open={importOpen} onOpenChange={setImportOpen} projectId={projectId} />
    </div>
  );
}
