"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CheckCircle2, ChevronDown, Download, Eye, FilePlus2, FileText, Filter, MoreHorizontal, Pencil, Plus, Search, Upload, Zap, FileX2, Copy, Trash2, Clock, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ProjectIdentity } from "@/features/planning/project-header";
import { planApi } from "@/features/planning/api";
import { fmtLong } from "@/features/planning/gantt-chart";
import { cn } from "@/lib/utils";
import { ImportQuotationDialog, QuotationFormDialog, toFormValues } from "./quotation-dialogs";
import { StatusChip, STATUS_COLOR } from "./status-chip";
import { compactMoney, STATUS_LABEL, type QStatus } from "./quotation";
import type { QuotationEventDTO, QuotationRowDTO, QuotationsData } from "./dto";

export const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
};
const EVENT_ICON: Record<string, { Icon: typeof CheckCircle2; cls: string }> = {
  APPROVED: { Icon: CheckCircle2, cls: "bg-green-100 text-green-600" }, REJECTED: { Icon: XCircle, cls: "bg-red-100 text-red-600" },
  SUBMITTED: { Icon: Upload, cls: "bg-blue-100 text-blue-600" }, REVISED: { Icon: Copy, cls: "bg-violet-100 text-violet-600" },
  UPDATED: { Icon: Pencil, cls: "bg-slate-100 text-slate-600" }, CREATED: { Icon: Plus, cls: "bg-slate-100 text-slate-600" },
};
export function EventList({ events, showNumber }: { events: QuotationEventDTO[]; showNumber?: boolean }) {
  if (events.length === 0) return <p className="py-6 text-center text-xs text-muted-foreground">No activity yet.</p>;
  return (
    <ul className="space-y-4">
      {events.map((e) => {
        const { Icon, cls } = EVENT_ICON[e.kind] ?? EVENT_ICON.UPDATED;
        return (
          <li key={e.id} className="flex items-start gap-3">
            <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", cls)}><Icon className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-snug">{showNumber && e.quotationNumber ? `${e.quotationNumber} — ` : ""}{e.message}</p><p className="text-xs text-muted-foreground">{e.by ? `${e.by} · ` : ""}{ago(e.at)}</p></div>
          </li>
        );
      })}
    </ul>
  );
}

type SortKey = "date" | "amount" | "number";

export function QuotationsView({ projectId, project, tabs, data, canEdit, canDelete }: { projectId: string; project: { name: string; number: string }; tabs: React.ReactNode; data: QuotationsData; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const s = data.summary;
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"" | QStatus>("");
  const [sort, setSort] = React.useState<SortKey>("date");
  const [formDlg, setFormDlg] = React.useState<{ open: boolean; row: QuotationRowDTO | null }>({ open: false, row: null });
  const [importOpen, setImportOpen] = React.useState(false);
  const [toDelete, setToDelete] = React.useState<QuotationRowDTO | null>(null);
  const [busy, setBusy] = React.useState(false);
  const base = `/api/projects/${projectId}/quotations`;

  const rows = React.useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = data.rows.filter((r) => (!term || [r.number, r.description, r.section].some((x) => x?.toLowerCase().includes(term))) && (!status || r.status === status));
    return [...list].sort((a, b) => sort === "amount" ? b.total - a.total : sort === "number" ? a.number.localeCompare(b.number) : b.issueDate.localeCompare(a.issueDate));
  }, [data.rows, q, status, sort]);

  async function revise(r: QuotationRowDTO) {
    const res = await planApi<{ id: string }>(`${base}/${r.id}/revise`, { method: "POST" });
    if (!res.ok) return void toast.error(res.error);
    toast.success("Revision created");
    router.push(`/projects/${projectId}/quotations/${res.data.id}`);
  }
  async function remove() {
    if (!toDelete) return;
    setBusy(true);
    const res = await planApi(`${base}/${toDelete.id}`, { method: "DELETE" });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success("Quotation deleted");
    setToDelete(null);
    router.refresh();
  }

  const donut = (["APPROVED", "PENDING", "UNDER_REVIEW", "REJECTED", "DRAFT"] as QStatus[]).map((k) => ({ k, name: STATUS_LABEL[k], value: data.rows.filter((r) => r.status === k).length })).filter((d) => d.value > 0);
  const card = (label: string, value: number, pct: number | null, icon: React.ReactNode, tint: string, valueCls: string, target: QStatus | "") => (
    <button type="button" onClick={() => setStatus(status === target ? "" : target)} className="text-left">
      <Card className={cn("h-full", status === target && target !== "" && "ring-2 ring-primary/40")}><CardContent className="flex items-center gap-3 p-4">
        <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tint)}>{icon}</span>
        <div><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="flex items-baseline gap-2"><span className="text-2xl font-semibold">{value}</span>{pct != null && <span className={cn("text-sm font-semibold", valueCls)}>{pct}%</span>}</p></div>
      </CardContent></Card>
    </button>
  );

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(300px,1.5fr)_repeat(4,minmax(0,1fr))]">
        <ProjectIdentity name={project.name} number={project.number} />
        {card("Total Quotations", s.total, null, <FileText className="h-5 w-5 text-primary" />, "bg-primary/10", "", "")}
        {card("Approved", s.approved, s.pctApproved, <CheckCircle2 className="h-5 w-5 text-green-600" />, "bg-green-500/10", "text-green-600", "APPROVED")}
        {card("Pending", s.pending, s.pctPending, <Clock className="h-5 w-5 text-amber-500" />, "bg-amber-500/10", "text-amber-500", "PENDING")}
        {card("Rejected", s.rejected, s.pctRejected, <XCircle className="h-5 w-5 text-red-500" />, "bg-red-500/10", "text-red-500", "REJECTED")}
      </div>
      {tabs}

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-3 shadow-sm">
        {canEdit && <Button onClick={() => setFormDlg({ open: true, row: null })}><Plus className="h-4 w-4" /> New Quotation</Button>}
        {canEdit && <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import from Excel</Button>}
        <Button variant="outline" asChild><a href={`${base}/export`}><Download className="h-4 w-4" /> Export</a></Button>
        <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs"><Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search quotations…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <label className="relative flex items-center"><Filter className="pointer-events-none absolute left-2.5 h-4 w-4 text-foreground/70" />
          <select className="h-9 rounded-lg border border-input bg-card pl-8 pr-3 text-sm font-medium shadow-sm" value={status} onChange={(e) => setStatus(e.target.value as QStatus | "")}>
            <option value="">All statuses</option>{(Object.keys(STATUS_LABEL) as QStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
          </select></label>
        <select className="h-9 rounded-lg border border-input bg-card px-3 text-sm font-medium shadow-sm" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="date">Sort by: Date</option><option value="amount">Sort by: Amount</option><option value="number">Sort by: Number</option>
        </select>
      </div>

      {data.rows.length === 0 ? (
        <EmptyState icon={<FilePlus2 />} title="No quotations yet" description={canEdit ? "Create one, or import a BOQ spreadsheet to start from your existing quantities." : undefined} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<FileX2 />} title="Nothing matches these filters" />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead><tr className="border-b border-border bg-secondary/60 text-left text-xs font-semibold">
                <th className="w-10 px-4 py-3">#</th><th className="px-3 py-3">Quotation No.</th><th className="px-3 py-3">Project Section</th><th className="px-3 py-3">Description</th>
                <th className="px-3 py-3 text-right">Total Amount ({data.rows[0]?.currency ?? "EGP"})</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Submitted Date</th><th className="px-3 py-3 text-right">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((r, n) => (
                  <tr key={r.id} className="border-b border-border/60 hover:bg-secondary/30">
                    <td className="px-4 py-3 text-muted-foreground">{n + 1}</td>
                    <td className="px-3 py-3 font-medium"><Link href={`/projects/${projectId}/quotations/${r.id}`} className="hover:text-primary hover:underline">{r.number}</Link>{r.revision > 0 && <span className="ml-1.5 rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">Rev. {r.revision}</span>}</td>
                    <td className="px-3 py-3">{r.section ?? "—"}</td>
                    <td className="px-3 py-3">{r.description}</td>
                    <td className="px-3 py-3 text-right font-medium tabular-nums">{Math.round(r.total).toLocaleString("en-US")}</td>
                    <td className="px-3 py-3"><StatusChip status={r.status} /></td>
                    <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{fmtLong(r.issueDate)}</td>
                    <td className="px-3 py-3"><div className="flex items-center justify-end gap-1.5">
                      <Button size="sm" variant="outline" className="h-8" asChild><Link href={`/projects/${projectId}/quotations/${r.id}`}><Eye className="h-3.5 w-3.5" /> View</Link></Button>
                      {canEdit && (r.status !== "APPROVED" && r.status !== "REJECTED") && <Button size="sm" variant="outline" className="h-8" onClick={() => setFormDlg({ open: true, row: r })}><Pencil className="h-3.5 w-3.5" /> Edit</Button>}
                      <Button size="sm" variant="outline" className="h-8 text-primary" asChild><a href={`/print/projects/${projectId}/quotations/${r.id}`} target="_blank" rel="noreferrer"><Download className="h-3.5 w-3.5" /> PDF</a></Button>
                      <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" className="h-8 w-8" aria-label="More"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild><a href={`${base}/${r.id}/export`}><Download className="h-4 w-4" /> Export Excel</a></DropdownMenuItem>
                          {canEdit && <DropdownMenuItem onClick={() => revise(r)}><Copy className="h-4 w-4" /> Create revision</DropdownMenuItem>}
                          {canDelete && <DropdownMenuItem className="text-destructive" onClick={() => setToDelete(r)}><Trash2 className="h-4 w-4" /> Delete</DropdownMenuItem>}
                        </DropdownMenuContent></DropdownMenu>
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Showing {rows.length} of {data.rows.length} quotation{data.rows.length === 1 ? "" : "s"} (latest revision of each).</p>
        </Card>
      )}

      {data.rows.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr_1fr]">
          <Card><CardHeader><CardTitle className="text-sm">Quotation Status</CardTitle></CardHeader><CardContent>
            <div className="flex items-center gap-4">
              <div className="relative h-40 w-40 shrink-0">
                <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donut} dataKey="value" innerRadius={50} outerRadius={72} paddingAngle={2} stroke="none" isAnimationActive={false}>{donut.map((d) => <Cell key={d.k} fill={STATUS_COLOR[d.k]} />)}</Pie></PieChart></ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-2xl font-semibold">{s.pctApproved}%</span><span className="text-[11px] text-muted-foreground">Approved</span></div>
              </div>
              <ul className="space-y-2 text-sm">{donut.map((d) => <li key={d.k} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLOR[d.k] }} /><span className="flex-1">{d.name}</span><b>{d.value}</b></li>)}</ul>
            </div>
          </CardContent></Card>
          <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">Quotation Value Trend</CardTitle><span className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground">Last 6 months <ChevronDown className="h-3 w-3" /></span></CardHeader><CardContent>
            <div className="h-44"><ResponsiveContainer width="100%" height="100%"><BarChart data={data.trend} margin={{ top: 18, right: 4, left: -20, bottom: 0 }}>
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={compactMoney} width={44} />
              <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} isAnimationActive={false}><LabelList dataKey="value" position="top" fontSize={10} formatter={(v: unknown) => (typeof v === "number" && v > 0 ? compactMoney(v) : "")} /></Bar>
            </BarChart></ResponsiveContainer></div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4 text-primary" /> Recent Activity</CardTitle></CardHeader><CardContent><EventList events={data.events.slice(0, 4)} showNumber /></CardContent></Card>
        </div>
      )}

      <QuotationFormDialog open={formDlg.open} onOpenChange={(o) => setFormDlg((x) => ({ ...x, open: o }))} projectId={projectId} quotation={formDlg.row ? toFormValues(formDlg.row) : null} />
      <ImportQuotationDialog open={importOpen} onOpenChange={setImportOpen} projectId={projectId} />
      <ConfirmDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)} title="Delete quotation?" description={toDelete ? `${toDelete.number}${toDelete.revision ? ` Rev. ${toDelete.revision}` : ""} and its BOQ items will be permanently removed.` : undefined} onConfirm={remove} loading={busy} />
    </div>
  );
}
