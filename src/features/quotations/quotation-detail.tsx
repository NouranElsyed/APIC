"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeDollarSign, CalendarDays, CheckCircle2, Copy, Download, FileSpreadsheet, FolderOpen, History, Loader2, Pencil, Percent, Plus, ScrollText, Send, Table2, Trash2, Wallet, Wrench, XCircle, ClipboardCheck, LayoutDashboard, Zap, Banknote } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { planApi } from "@/features/planning/api";
import { fmtLong } from "@/features/planning/gantt-chart";
import { cn } from "@/lib/utils";
import { QuotationFormDialog, toFormValues } from "./quotation-dialogs";
import { EventList } from "./quotations-view";
import { StatusChip } from "./status-chip";
import { daysBetween, lineTotal, money, nextStatuses, totals, TYPE_LABEL, type QStatus, type QType } from "./quotation";
import type { QuotationDetailDTO } from "./dto";

type Tab = "overview" | "boq" | "terms" | "history";
const TABS: { id: Tab; label: string; icon: typeof Table2 }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard }, { id: "boq", label: "BOQ Details", icon: Table2 },
  { id: "terms", label: "Terms & Conditions", icon: ScrollText }, { id: "history", label: "History", icon: History },
];
const fmtNum = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

interface Draft { key: string; description: string; material: string; qty: string; unit: string; unitRate: string; type: QType }
let seq = 0;
const toDraft = (i: QuotationDetailDTO["items"][number]): Draft => ({ key: i.id, description: i.description, material: i.material ?? "", qty: String(i.qty), unit: i.unit, unitRate: String(i.unitRate), type: i.type });
const blank = (): Draft => ({ key: `new-${++seq}`, description: "", material: "", qty: "1", unit: "kg", unitRate: "0", type: "SUPPLY" });
const n = (s: string) => (s.trim() === "" ? NaN : Number(s));

export function QuotationDetail({ q, canEdit, canApprove }: { q: QuotationDetailDTO; canEdit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [tab, setTab] = React.useState<Tab>("overview");
  const [editOpen, setEditOpen] = React.useState(false);
  const [statusDlg, setStatusDlg] = React.useState<QStatus | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [drafts, setDrafts] = React.useState<Draft[]>(() => q.items.map(toDraft));
  const [terms, setTerms] = React.useState(q.terms ?? "");

  const base = `/api/projects/${q.project.id}/quotations/${q.id}`;
  const listHref = `/projects/${q.project.id}/quotations`;
  const live = totals(drafts.map((d) => ({ qty: Number.isFinite(n(d.qty)) ? n(d.qty) : 0, unitRate: Number.isFinite(n(d.unitRate)) ? n(d.unitRate) : 0, type: d.type })));
  const sig = (l: Draft[]) => JSON.stringify(l.map((d) => [d.description, d.material, d.qty, d.unit, d.unitRate, d.type]));
  const dirty = sig(drafts) !== sig(q.items.map(toDraft));
  const validDays = q.validUntil ? daysBetween(q.issueDate, q.validUntil) : null;
  const next = nextStatuses(q.status);

  async function saveItems() {
    const items = [];
    for (const [i, d] of drafts.entries()) {
      const qty = n(d.qty), rate = n(d.unitRate);
      if (!d.description.trim()) return void toast.error(`Row ${i + 1}: add a description.`);
      if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(rate) || rate < 0) return void toast.error(`Row ${i + 1}: quantity and unit rate must be numbers.`);
      items.push({ description: d.description.trim(), material: d.material.trim() || null, qty, unit: d.unit.trim() || "kg", unitRate: rate, type: d.type });
    }
    setBusy(true);
    const r = await planApi(base, { method: "PATCH", body: { items } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("BOQ saved");
    router.refresh();
  }
  async function saveTerms() {
    setBusy(true);
    const r = await planApi(base, { method: "PATCH", body: { terms } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Terms saved");
    router.refresh();
  }
  async function changeStatus() {
    if (!statusDlg) return;
    setBusy(true);
    const r = await planApi(`${base}/status`, { method: "POST", body: { status: statusDlg, note: note || undefined } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Status updated");
    setStatusDlg(null); setNote("");
    router.refresh();
  }
  async function revise() {
    setBusy(true);
    const r = await planApi<{ id: string }>(`${base}/revise`, { method: "POST" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Revision created");
    router.push(`${listHref}/${r.data.id}`);
  }

  const action = (to: QStatus) => {
    const map: Partial<Record<QStatus, { label: string; icon: React.ReactNode; cls?: string; needs?: "edit" | "approve" }>> = {
      PENDING: { label: "Submit", icon: <Send className="h-4 w-4" />, needs: "edit" },
      UNDER_REVIEW: { label: "Send for review", icon: <ClipboardCheck className="h-4 w-4" />, needs: "edit" },
      APPROVED: { label: "Approve", icon: <CheckCircle2 className="h-4 w-4" />, cls: "bg-green-600 text-white hover:bg-green-700", needs: "approve" },
      REJECTED: { label: "Reject", icon: <XCircle className="h-4 w-4" />, cls: "border-red-200 text-red-600 hover:bg-red-50", needs: "approve" },
      DRAFT: { label: "Back to draft", icon: <Pencil className="h-4 w-4" />, needs: "edit" },
    };
    const a = map[to]; if (!a) return null;
    if (a.needs === "approve" ? !canApprove : !canEdit) return null;
    return <Button key={to} variant={to === "APPROVED" ? "default" : "outline"} className={a.cls} onClick={() => setStatusDlg(to)}>{a.icon} {a.label}</Button>;
  };

  const stat = (icon: React.ReactNode, tint: string, label: string, value: React.ReactNode, cls?: string) => (
    <Card className={cls}><CardContent className="flex items-center gap-3 p-4"><span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tint)}>{icon}</span><div className="min-w-0"><p className="truncate text-xs font-medium text-muted-foreground">{label}</p><div className="truncate text-xl font-semibold tracking-tight">{value}</div></div></CardContent></Card>
  );

  return (
    <div className="space-y-5">
      {/* ---- header ---- */}
      <div className="grid gap-3 xl:grid-cols-[minmax(320px,1.6fr)_1fr_1fr_1.2fr]">
        <Card><CardContent className="flex items-center gap-4 p-4">
          <div className="flex h-14 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-300 via-blue-500 to-slate-800 text-white"><ScrollText className="h-6 w-6" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold leading-tight">Quotation #{q.number}</h2>{q.revision > 0 && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700">Rev. {q.revision}</span>}<StatusChip status={q.status} large /></div>
            <p className="mt-1 truncate text-sm text-muted-foreground">{q.project.name} · Project #{q.project.number}</p>
          </div>
        </CardContent></Card>
        {stat(<CalendarDays className="h-5 w-5 text-primary" />, "bg-primary/10", "Issue Date", fmtLong(q.issueDate))}
        {stat(<CalendarDays className="h-5 w-5 text-primary" />, "bg-primary/10", "Valid Until", <>{q.validUntil ? fmtLong(q.validUntil) : "—"}{validDays != null && <span className="block text-xs font-normal text-muted-foreground">({validDays} Days)</span>}</>)}
        <Card className="border-0 bg-primary text-primary-foreground"><CardContent className="flex items-center gap-3 p-4"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/15"><Wallet className="h-5 w-5" /></span><div className="min-w-0"><p className="text-xs font-medium opacity-80">Total Quotation Value</p><p className="truncate text-xl font-semibold">{money(q.grand, q.currency)}</p></div></CardContent></Card>
      </div>

      {/* ---- actions ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" asChild><Link href={listHref}><ArrowLeft className="h-4 w-4" /> Back to Quotations</Link></Button>
        <Button asChild><a href={`/print/projects/${q.project.id}/quotations/${q.id}`} target="_blank" rel="noreferrer"><Download className="h-4 w-4" /> Download PDF</a></Button>
        <Button variant="outline" className="border-green-200 bg-green-50 text-green-800 hover:bg-green-100" asChild><a href={`${base}/export`}><FileSpreadsheet className="h-4 w-4 text-green-600" /> Export Excel</a></Button>
        {canEdit && <Button variant="outline" onClick={revise} disabled={busy}><Copy className="h-4 w-4" /> Create Revision</Button>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {next.map(action)}
          {canEdit && q.editable && <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" /> Edit</Button>}
        </div>
      </div>
      {!q.editable && canEdit && <p className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">This quotation is {q.status === "APPROVED" ? "approved" : "rejected"} and locked. Use <b>Create Revision</b> to change it.</p>}

      {/* ---- tabs ---- */}
      <nav className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => <button key={t.id} type="button" onClick={() => setTab(t.id)} className={cn("-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium", tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}><t.icon className="h-4 w-4" />{t.label}</button>)}
        <span aria-disabled title="Coming soon" className="-mb-px flex cursor-not-allowed items-center gap-2 whitespace-nowrap border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted-foreground/50"><FolderOpen className="h-4 w-4" />Related Documents</span>
      </nav>

      {tab === "overview" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {stat(<Wrench className="h-5 w-5 text-primary" />, "bg-primary/10", "Total Supply", money(q.items.length ? totals(q.items).supply : 0, q.currency))}
            {stat(<Wrench className="h-5 w-5 text-teal-600" />, "bg-teal-500/10", "Total Dismantle & Install", money(totals(q.items).install, q.currency))}
            {stat(<BadgeDollarSign className="h-5 w-5 text-blue-600" />, "bg-blue-500/10", "Grand Total", money(q.grand, q.currency))}
            {stat(<Percent className="h-5 w-5 text-violet-600" />, "bg-violet-500/10", "Profit Margin", q.profitMargin != null ? `${q.profitMargin}%` : "—")}
            {stat(<CheckCircle2 className="h-5 w-5 text-green-600" />, "bg-green-500/10", "Quotation Status", <StatusChip status={q.status} large />)}
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.9fr_1fr]">
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Table2 className="h-4 w-4 text-primary" /> BOQ Summary</CardTitle></CardHeader><CardContent className="px-0 pb-0">
              {q.items.length === 0 ? <p className="px-6 pb-6 text-sm text-muted-foreground">No BOQ items yet. {canEdit && q.editable && <button className="text-primary underline" onClick={() => setTab("boq")}>Add items</button>}</p> : (
                <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="border-y border-border bg-secondary/60 text-left text-xs font-semibold"><th className="px-4 py-2.5">#</th><th className="px-3 py-2.5">Item Description</th><th className="px-3 py-2.5">Material</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5">Unit</th><th className="px-3 py-2.5 text-right">Unit Rate ({q.currency})</th><th className="px-4 py-2.5 text-right">Total ({q.currency})</th></tr></thead>
                  <tbody>{q.items.map((i, k) => <tr key={i.id} className="border-b border-border/60"><td className="px-4 py-2.5 text-muted-foreground">{k + 1}</td><td className="px-3 py-2.5">{i.description}</td><td className="px-3 py-2.5">{i.material ?? "—"}</td><td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(i.qty)}</td><td className="px-3 py-2.5">{i.unit}</td><td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(i.unitRate)}</td><td className="px-4 py-2.5 text-right font-medium tabular-nums">{fmtNum(i.total)}</td></tr>)}</tbody>
                  <tfoot><tr className="bg-secondary/40 font-semibold"><td colSpan={6} className="px-4 py-3 text-right">Grand Total</td><td className="px-4 py-3 text-right tabular-nums">{fmtNum(q.grand)}</td></tr></tfoot>
                </table></div>
              )}
            </CardContent></Card>
            <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Banknote className="h-4 w-4 text-primary" /> Quotation Details</CardTitle></CardHeader><CardContent>
              <dl className="divide-y divide-border/60 text-sm">
                {([["Project", q.project.name], ["Customer", q.project.customer], ["Quotation No.", q.number], ["Revision", `Rev. ${q.revision}`], ["Section", q.section ?? "—"], ["Issue Date", fmtLong(q.issueDate)], ["Valid Until", q.validUntil ? `${fmtLong(q.validUntil)}${validDays != null ? ` (${validDays} Days)` : ""}` : "—"], ["Prepared By", q.preparedBy ?? "—"], ["Approved By", q.approvedBy ?? "—"]] as [string, string][]).map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
              </dl>
            </CardContent></Card>
          </div>
          <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4 text-primary" /> Recent Activity</CardTitle></CardHeader><CardContent><EventList events={q.events.slice(0, 4)} /></CardContent></Card>
        </>
      )}

      {tab === "boq" && (
        <Card><CardContent className="p-0">
          <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm">
            <thead><tr className="border-b border-border bg-secondary/60 text-left text-xs font-semibold"><th className="w-10 px-3 py-2.5">#</th><th className="px-2 py-2.5">Item Description</th><th className="w-28 px-2 py-2.5">Material</th><th className="w-28 px-2 py-2.5 text-right">Qty</th><th className="w-20 px-2 py-2.5">Unit</th><th className="w-32 px-2 py-2.5 text-right">Unit Rate</th><th className="w-44 px-2 py-2.5">Type</th><th className="w-32 px-3 py-2.5 text-right">Total</th><th className="w-10" /></tr></thead>
            <tbody>
              {drafts.map((d, k) => {
                const set = (p: Partial<Draft>) => setDrafts((l) => l.map((x) => (x.key === d.key ? { ...x, ...p } : x)));
                const t = lineTotal({ qty: Number.isFinite(n(d.qty)) ? n(d.qty) : 0, unitRate: Number.isFinite(n(d.unitRate)) ? n(d.unitRate) : 0 });
                const cell = "h-8 px-2 text-sm";
                return (
                  <tr key={d.key} className="border-b border-border/60">
                    <td className="px-3 py-1.5 text-muted-foreground">{k + 1}</td>
                    <td className="px-2 py-1.5"><Input className={cell} value={d.description} disabled={!q.editable || !canEdit} onChange={(e) => set({ description: e.target.value })} /></td>
                    <td className="px-2 py-1.5"><Input className={cell} value={d.material} disabled={!q.editable || !canEdit} onChange={(e) => set({ material: e.target.value })} /></td>
                    <td className="px-2 py-1.5"><Input className={cn(cell, "text-right")} type="number" min={0} step="any" value={d.qty} disabled={!q.editable || !canEdit} onChange={(e) => set({ qty: e.target.value })} /></td>
                    <td className="px-2 py-1.5"><Input className={cell} value={d.unit} disabled={!q.editable || !canEdit} onChange={(e) => set({ unit: e.target.value })} /></td>
                    <td className="px-2 py-1.5"><Input className={cn(cell, "text-right")} type="number" min={0} step="any" value={d.unitRate} disabled={!q.editable || !canEdit} onChange={(e) => set({ unitRate: e.target.value })} /></td>
                    <td className="px-2 py-1.5"><select className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm disabled:opacity-60" value={d.type} disabled={!q.editable || !canEdit} onChange={(e) => set({ type: e.target.value as QType })}>{(Object.keys(TYPE_LABEL) as QType[]).map((k2) => <option key={k2} value={k2}>{TYPE_LABEL[k2]}</option>)}</select></td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">{fmtNum(t)}</td>
                    <td className="px-1">{q.editable && canEdit && <button type="button" aria-label="Remove row" className="rounded p-1.5 text-muted-foreground hover:text-destructive" onClick={() => setDrafts((l) => l.filter((x) => x.key !== d.key))}><Trash2 className="h-4 w-4" /></button>}</td>
                  </tr>
                );
              })}
              {drafts.length === 0 && <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-muted-foreground">No items yet.</td></tr>}
            </tbody>
            <tfoot className="bg-secondary/40 text-sm">
              <tr><td colSpan={7} className="px-3 py-2 text-right text-muted-foreground">Total Supply</td><td className="px-3 py-2 text-right tabular-nums">{fmtNum(live.supply)}</td><td /></tr>
              <tr><td colSpan={7} className="px-3 py-2 text-right text-muted-foreground">Total Dismantle & Install</td><td className="px-3 py-2 text-right tabular-nums">{fmtNum(live.install)}</td><td /></tr>
              <tr className="font-semibold"><td colSpan={7} className="px-3 py-2.5 text-right">Grand Total ({q.currency})</td><td className="px-3 py-2.5 text-right tabular-nums">{fmtNum(live.grand)}</td><td /></tr>
            </tfoot>
          </table></div>
          {q.editable && canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-3">
              <Button variant="outline" size="sm" onClick={() => setDrafts((l) => [...l, blank()])}><Plus className="h-4 w-4" /> Add item</Button>
              <div className="flex items-center gap-2">{dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}{dirty && <Button variant="ghost" size="sm" onClick={() => setDrafts(q.items.map(toDraft))}>Discard</Button>}<Button size="sm" onClick={saveItems} disabled={!dirty || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save BOQ</Button></div>
            </div>
          )}
        </CardContent></Card>
      )}

      {tab === "terms" && (
        <Card><CardContent className="space-y-3 p-5">
          {q.editable && canEdit ? (
            <>
              <Textarea rows={14} value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={"Payment terms, delivery period, warranty, exclusions…\nOne clause per line."} />
              <div className="flex justify-end"><Button onClick={saveTerms} disabled={busy || terms === (q.terms ?? "")}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save terms</Button></div>
            </>
          ) : q.terms ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{q.terms}</p> : <p className="text-sm text-muted-foreground">No terms & conditions were added.</p>}
        </CardContent></Card>
      )}

      {tab === "history" && (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <Card><CardHeader><CardTitle className="text-sm">Activity</CardTitle></CardHeader><CardContent><EventList events={q.events} /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-sm">Revisions</CardTitle></CardHeader><CardContent>
            <ul className="space-y-2">{q.revisions.map((r) => (
              <li key={r.id}><Link href={`${listHref}/${r.id}`} className={cn("flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm hover:bg-secondary/50", r.id === q.id && "border-primary bg-primary/5")}>
                <span className="font-medium">Rev. {r.revision}<span className="ml-2 text-xs font-normal text-muted-foreground">{fmtLong(r.issueDate)}</span></span><span className="flex items-center gap-2"><span className="text-xs tabular-nums text-muted-foreground">{fmtNum(r.total)}</span><StatusChip status={r.status} /></span>
              </Link></li>
            ))}</ul>
          </CardContent></Card>
        </div>
      )}

      <QuotationFormDialog open={editOpen} onOpenChange={setEditOpen} projectId={q.project.id} quotation={toFormValues(q)} />
      <Dialog open={!!statusDlg} onOpenChange={(o) => { if (!o) { setStatusDlg(null); setNote(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{statusDlg === "APPROVED" ? "Approve quotation?" : statusDlg === "REJECTED" ? "Reject quotation?" : statusDlg === "DRAFT" ? "Return to draft?" : "Submit quotation?"}</DialogTitle><DialogDescription>{statusDlg === "APPROVED" || statusDlg === "REJECTED" ? `${q.number} will be locked. To change it later, create a revision.` : `${q.number} moves to ${statusDlg === "DRAFT" ? "Draft" : statusDlg === "UNDER_REVIEW" ? "Under Review" : "Pending"}.`}</DialogDescription></DialogHeader>
          <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <DialogFooter><Button variant="ghost" onClick={() => setStatusDlg(null)}>Cancel</Button><Button onClick={changeStatus} disabled={busy} className={statusDlg === "REJECTED" ? "bg-red-600 text-white hover:bg-red-700" : undefined}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Confirm</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
