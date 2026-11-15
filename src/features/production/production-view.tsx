"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Factory, Link2, Loader2, Play, Printer, QrCode, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProductionData, SyncResult, WorkOrderDTO } from "@/server/services/production.service";
import { STAGES, STAGE_LABEL, prevStage, type Stage } from "./production";

const kg = (n: number) => `${(n / 1000).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
const STAGE_COLOR: Record<Stage, string> = { CUTTING: "bg-sky-500", ASSEMBLY: "bg-indigo-500", WELDING: "bg-amber-500", PAINTING: "bg-emerald-500" };
const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

async function call<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: body !== undefined ? { "Content-Type": "application/json" } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof json?.error === "string" ? json.error : "Something went wrong");
  return json as T;
}
function reportSync(sync: SyncResult | null | undefined) {
  if (!sync) return;
  if (sync.synced && sync.updated > 0) toast.success(`Schedule updated: ${sync.updated} activit${sync.updated === 1 ? "y" : "ies"} now at ${sync.percent}%`);
  else if (!sync.synced && sync.reason) toast.info(sync.reason);
}

/** Pieces that can take `stage` now: those that finished the stage before it and not this one. */
const ready = (o: WorkOrderDTO, s: Stage) => {
  const p = prevStage(s);
  return (p ? o.stats.done[p] : o.qty) - o.stats.done[s];
};

export function ProductionView({ data, canEdit, canUpdate }: { data: ProductionData; canEdit: boolean; canUpdate: boolean }) {
  const router = useRouter();
  const { summary: sm, orders, unreleased, schedule } = data;
  const [recording, setRecording] = React.useState<WorkOrderDTO | null>(null);
  const [releasing, setReleasing] = React.useState(false);
  const [due, setDue] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function release() {
    setBusy(true);
    try {
      const r = await call<{ created: number; pieces: number }>(`/api/projects/${data.project.id}/production`, "POST", { dueDate: due || null });
      toast.success(`${r.created} work order${r.created === 1 ? "" : "s"} created (${r.pieces} pieces)`);
      setReleasing(false);
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not create the work orders"); } finally { setBusy(false); }
  }
  async function link(wbsId: string) {
    try {
      const r = await call<{ sync: SyncResult | null }>(`/api/projects/${data.project.id}/production`, "PATCH", { wbsId: wbsId || null });
      toast.success(wbsId ? "Schedule linked to production" : "Schedule unlinked");
      reportSync(r.sync);
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not link the schedule"); }
  }
  async function remove(o: WorkOrderDTO) {
    if (!window.confirm(`Delete ${o.number}?`)) return;
    try { await call(`/api/work-orders/${o.id}`, "DELETE"); toast.success(`${o.number} deleted`); router.refresh(); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not delete"); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Progress by weight" value={`${sm.percent}%`}>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${sm.percent}%` }} /></div>
        </Kpi>
        <Kpi label="Tons made" value={`${kg(sm.producedKg)} of ${kg(sm.totalKg)}`} note="stage-weighted: cutting 25 · assembly 25 · welding 35 · painting 15" />
        <Kpi label="Fully finished (painted)" value={kg(sm.byStageKg.PAINTING)} note={`${sm.totalKg > 0 ? Math.round((sm.byStageKg.PAINTING / sm.totalKg) * 100) : 0}% of the project`} />
        <Kpi label="Not released to the shop" value={kg(sm.unplannedKg)} note={unreleased.length ? `${unreleased.length} part${unreleased.length === 1 ? "" : "s"} without a work order` : "every part has a work order"} warn={unreleased.length > 0} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Factory className="h-4 w-4 text-primary" />Tons per stage</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {STAGES.map((s) => {
              const v = sm.byStageKg[s];
              const p = sm.totalKg > 0 ? (v / sm.totalKg) * 100 : 0;
              return (
                <div key={s} className="grid grid-cols-[90px_1fr_130px] items-center gap-3 text-sm">
                  <span className="font-medium">{STAGE_LABEL[s]}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", STAGE_COLOR[s])} style={{ width: `${p}%` }} /></div>
                  <span className="text-right tabular-nums text-muted-foreground">{kg(v)} · {Math.round(p)}%</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Link2 className="h-4 w-4 text-primary" />Schedule link</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!schedule.exists ? <p className="text-muted-foreground">This project has no schedule yet. Create one in Planning to feed its S-curve from production.</p> : (
              <>
                <p className="text-muted-foreground">Pick the part of the schedule that is the shop work. Every task under it follows the production percentage, so the S-curve &ldquo;actual&rdquo; is fed from here instead of by hand.</p>
                <select className={selectClass} value={schedule.linkedWbsId ?? ""} disabled={!canEdit} onChange={(e) => void link(e.target.value)} aria-label="Schedule WBS driven by production">
                  <option value="">Not linked</option>
                  {schedule.wbs.map((w) => <option key={w.id} value={w.id}>{"— ".repeat(w.level)}{w.code} {w.name}</option>)}
                </select>
                {schedule.linkedWbsId && <p className="flex items-center gap-1.5 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />{schedule.linkedActivities} activit{schedule.linkedActivities === 1 ? "y follows" : "ies follow"} production ({sm.percent}%). Editing their % by hand is overwritten at the next update.</p>}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Work orders</CardTitle>
          {canEdit && unreleased.length > 0 && <Button onClick={() => setReleasing(true)}><Play /> Release {unreleased.length} part{unreleased.length === 1 ? "" : "s"} to the shop</Button>}
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {unreleased.length ? "No work orders yet. Release the project's parts to the shop to start tracking." : "This project has no parts in Part List yet."}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr><th className="px-3 py-2.5 text-left font-semibold">Work order</th><th className="px-3 py-2.5 text-left font-semibold">Part</th><th className="px-3 py-2.5 text-right font-semibold">Qty</th><th className="px-3 py-2.5 text-right font-semibold">Weight</th>
                    {STAGES.map((s) => <th key={s} className="px-2 py-2.5 text-center font-semibold">{STAGE_LABEL[s]}</th>)}
                    <th className="px-3 py-2.5 text-right font-semibold">Done</th><th /></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2.5 font-medium">{o.number}</td>
                      <td className="px-3 py-2.5">{o.partNo != null && <span className="text-muted-foreground">#{o.partNo} </span>}{o.description}{o.material && <p className="text-xs text-muted-foreground">{o.material}</p>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{o.qty}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{kg(o.stats.totalKg)}</td>
                      {STAGES.map((s) => (
                        <td key={s} className="px-2 py-2.5 text-center tabular-nums">
                          <span className={cn("rounded-md px-1.5 py-0.5 text-xs font-semibold", o.stats.done[s] === o.qty ? "bg-green-500/10 text-green-700" : o.stats.done[s] > 0 ? "bg-amber-500/10 text-amber-700" : "text-muted-foreground")}>{o.stats.done[s]}/{o.qty}</span>
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{Math.round(o.stats.progress)}%</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right">
                        {canUpdate && <Button size="sm" variant="outline" onClick={() => setRecording(o)} disabled={o.stats.progress >= 100}>Record</Button>}
                        <a href={`/print/work-orders/${o.id}/labels`} target="_blank" rel="noreferrer" aria-label={`QR labels for ${o.number}`} title="Print the QR labels" className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted"><QrCode className="h-4 w-4" /></a>
                        {canEdit && o.stats.progress === 0 && <Button size="icon" variant="ghost" className="text-destructive" aria-label={`Delete ${o.number}`} onClick={() => void remove(o)}><Trash2 /></Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">On the shop floor, scan a piece&apos;s QR label with a phone to finish its next stage. <Printer className="inline h-3 w-3" /> Labels print from the QR button.</p>
        </CardContent>
      </Card>

      <Dialog open={releasing} onOpenChange={(v) => !busy && setReleasing(v)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Release to the shop</DialogTitle><DialogDescription>One work order is created for each of the {unreleased.length} parts that has none ({kg(sm.unplannedKg)}). Each piece gets its own number for the QR label.</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label className="text-xs">Due date (optional)</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReleasing(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void release()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Play />} Create work orders</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {recording && <RecordDialog order={recording} onClose={() => setRecording(null)} />}
    </div>
  );
}

function RecordDialog({ order, onClose }: { order: WorkOrderDTO; onClose: () => void }) {
  const router = useRouter();
  const first = STAGES.find((s) => ready(order, s) > 0) ?? "CUTTING";
  const [stage, setStage] = React.useState<Stage>(first);
  const [count, setCount] = React.useState(String(Math.max(1, ready(order, first))));
  const [busy, setBusy] = React.useState(false);
  const r = ready(order, stage);
  const n = Math.round(Number(count));
  const pick = (s: Stage) => { setStage(s); setCount(String(Math.max(1, ready(order, s)))); };

  async function save() {
    setBusy(true);
    try {
      const res = await call<{ advanced: number; sync: SyncResult }>(`/api/work-orders/${order.id}/progress`, "POST", { stage, count: n });
      toast.success(`${res.advanced} piece${res.advanced === 1 ? "" : "s"} finished ${STAGE_LABEL[stage].toLowerCase()}`);
      reportSync(res.sync);
      onClose();
      router.refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not record the progress"); } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Record progress — {order.number}</DialogTitle><DialogDescription>{order.description} · {order.qty} pieces. Pieces move through the stages in order.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {STAGES.map((s) => (
            <button key={s} type="button" onClick={() => pick(s)} disabled={ready(order, s) <= 0}
              className={cn("rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40", stage === s ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50")}>
              <span className="font-medium">{STAGE_LABEL[s]}</span><span className="block text-xs text-muted-foreground">{ready(order, s)} ready · {order.stats.done[s]} done</span>
            </button>
          ))}
        </div>
        <div className="space-y-1.5"><Label className="text-xs">How many pieces finished {STAGE_LABEL[stage].toLowerCase()}?</Label><Input type="number" min={1} max={r} step={1} value={count} onChange={(e) => setCount(e.target.value)} /></div>
        {n > r && <p className="text-xs text-red-600">Only {r} piece{r === 1 ? " is" : "s are"} ready for {STAGE_LABEL[stage].toLowerCase()}.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !(n >= 1) || n > r}>{busy && <Loader2 className="animate-spin" />} Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Kpi({ label, value, note, warn, children }: { label: string; value: string; note?: string; warn?: boolean; children?: React.ReactNode }) {
  return (
    <Card><CardContent className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn("text-xl font-semibold tracking-tight", warn && "text-amber-600")}>{value}</p>
      {children}
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </CardContent></Card>
  );
}
