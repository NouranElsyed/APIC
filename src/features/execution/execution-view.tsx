"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, BadgeCheck, CalendarRange, CheckCircle2, Circle, Coins, Loader2, PackageCheck, Rocket, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ProjectIdentity } from "@/features/planning/project-header";
import type { ConversionResult, ExecutionPreflight } from "@/server/services/execution.service";

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function ExecutionView({ data, tabs, canConvert }: { data: ExecutionPreflight; tabs: React.ReactNode; canConvert: boolean }) {
  const router = useRouter();
  const { project: p } = data;
  const [startDate, setStartDate] = React.useState(p.startDate ?? new Date().toISOString().slice(0, 10));
  const [supplyDays, setSupplyDays] = React.useState("14");
  const [installDays, setInstallDays] = React.useState("10");
  const [unit, setUnit] = React.useState<"sheet" | "kg">("sheet");
  const [ack, setAck] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<ConversionResult | null>(null);

  const hasApprox = data.warnings.some((w) => w.code === "APPROXIMATE_PARTS");
  const blocked = data.blockers.length > 0;
  const ready = !blocked && canConvert && (!hasApprox || ack);

  async function convert() {
    setBusy(true);
    try {
      const res = await fetch(`/api/projects/${p.id}/execution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startDate, supplyDays: Number(supplyDays) || 14, installDays: Number(installDays) || 10, materialUnit: unit, acceptApproximate: ack }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body?.error === "string" ? body.error : "Could not convert the project");
      setResult(body as ConversionResult);
      setConfirm(false);
      toast.success("Project converted to execution");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not convert the project");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 lg:grid-cols-[minmax(300px,1.6fr)_1fr]">
        <ProjectIdentity name={p.name} number={p.number} />
        <Card><CardContent className="flex h-full items-center justify-center p-4">
          <span className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-base font-semibold", p.stage === "EXECUTION" ? "bg-green-500/10 text-green-700" : "bg-amber-500/10 text-amber-700")}>
            {p.stage === "EXECUTION" ? <BadgeCheck className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
            {p.stage === "EXECUTION" ? "In execution" : "Tendering"}
          </span>
        </CardContent></Card>
      </div>
      {tabs}

      {p.stage === "EXECUTION" || result ? (
        <Converted data={data} result={result} projectId={p.id} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Rocket className="h-4 w-4 text-primary" />Convert to execution</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">When you convert, the system does this for you:</p>
                <ul className="space-y-3 text-sm">
                  <Step ok={data.approved.length > 0} icon={<Coins className="h-4 w-4" />} title="Budget from the approved quotation"
                    text={data.budget ? `${data.budget.currency} ${money(data.budget.total)} (${data.approved.length} approved quotation${data.approved.length > 1 ? "s" : ""}) — frozen as the project budget.` : "Needs an approved quotation."} />
                  <Step ok={data.boqItems > 0 || data.schedule.activities > 0} icon={<CalendarRange className="h-4 w-4" />} title="First schedule from the BOQ, then its baseline"
                    text={data.schedule.activities > 0 ? `The existing schedule (${data.schedule.activities} activities) is kept; a baseline is saved if there is none.` : data.boqItems > 0 ? `${data.boqItems} BOQ item${data.boqItems > 1 ? "s" : ""} become activities (supply first, then installation). Durations are a starting guess — edit them in Planning.` : "No BOQ items, so no schedule is built."} />
                  <Step ok={data.nest.hasResult} icon={<PackageCheck className="h-4 w-4" />} title="Material requests from the nest, scrap included"
                    text={data.nest.hasResult ? `${data.nest.lines} material line${data.nest.lines > 1 ? "s" : ""} (sheets of each size) are sent to Materials, ready to order.` : "No nesting result yet — nothing is sent to Materials."} />
                  <Step ok={!blocked} icon={<Rocket className="h-4 w-4" />} title="The project moves to execution" text="Stage becomes Execution and status In Progress." />
                </ul>
              </CardContent>
            </Card>

            {(data.blockers.length > 0 || data.warnings.length > 0) && (
              <Card><CardContent className="space-y-3 p-4">
                {data.blockers.map((b) => <Note key={b} tone="bad" text={b} />)}
                {data.warnings.map((w) => <Note key={w.code} tone="warn" text={w.text} />)}
                {hasApprox && data.nest.approxNames.length > 0 && (
                  <p className="text-xs text-muted-foreground">Approximate parts include: <span className="font-medium text-foreground">{data.nest.approxNames.join(", ")}{data.nest.approx > data.nest.approxNames.length ? "…" : ""}</span>. Tick “Exact” on them in Nest Boost once they are drawn as they will be cut.</p>
                )}
                {hasApprox && !blocked && (
                  <label className="flex cursor-pointer items-start gap-2 text-sm"><Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" /><span>I understand — convert anyway, the material quantities are an estimate.</span></label>
                )}
              </CardContent></Card>
            )}
          </div>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Options</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Schedule start"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Supply item (days)"><Input type="number" min={1} value={supplyDays} onChange={(e) => setSupplyDays(e.target.value)} /></Field>
                <Field label="Install item (days)"><Input type="number" min={1} value={installDays} onChange={(e) => setInstallDays(e.target.value)} /></Field>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Order the sheets in</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={unit === "sheet" ? "default" : "outline"} onClick={() => setUnit("sheet")}>Sheets</Button>
                  <Button type="button" size="sm" variant={unit === "kg" ? "default" : "outline"} onClick={() => setUnit("kg")}>Kilograms</Button>
                </div>
              </div>
              <Button className="w-full" disabled={!ready} onClick={() => setConfirm(true)}><Rocket /> Convert to execution</Button>
              {!canConvert && <p className="text-xs text-muted-foreground">You need permission to edit projects and planning to convert.</p>}
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={confirm} onOpenChange={(v) => !busy && setConfirm(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convert {p.number} to execution?</DialogTitle>
            <DialogDescription>The budget is frozen from the approved quotations, the schedule and its baseline are created, and material requests are sent. This changes the project&apos;s stage.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={busy}>Cancel</Button>
            <Button onClick={() => void convert()} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Rocket />} Convert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Converted({ data, result, projectId }: { data: ExecutionPreflight; result: ConversionResult | null; projectId: string }) {
  const budget = result?.budget ?? data.converted?.budget ?? null;
  const when = data.converted?.at;
  return (
    <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><BadgeCheck className="h-4 w-4 text-green-600" />This project is in execution</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {when && <p className="text-muted-foreground">Converted on {fmtDate(when)}.</p>}
          {budget ? (
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted-foreground">Frozen budget</p>
              <p className="text-2xl font-semibold tracking-tight">{budget.currency} {money(budget.total)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Supply {money(budget.supply)} · Dismantle &amp; Install {money(budget.install)} · from {budget.quotations.map((q) => `${q.number}${q.revision ? ` Rev. ${q.revision}` : ""}`).join(", ")}</p>
            </div>
          ) : <p className="text-muted-foreground">No frozen budget was recorded for this project.</p>}
          {result && (
            <ul className="space-y-1.5">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" />{result.schedule.created ? `Schedule created with ${result.schedule.activities} activities` : "Existing schedule kept"}{result.schedule.baselineSaved ? ", baseline saved" : ""}</li>
              <li className="flex items-center gap-2">{result.materials.skipped ? <Circle className="h-4 w-4 text-muted-foreground" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />}{result.materials.skipped ?? `Materials: ${result.materials.created} added, ${result.materials.updated} updated`}</li>
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Go to</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <Go href={`/projects/${projectId}/planning`} label="Planning — edit durations and logic" />
          <Go href={`/projects/${projectId}/planning`} label="Planning › Materials — place the orders" />
          <Go href={`/projects/${projectId}/reports`} label="Reports — progress against the budget" />
          <Go href={`/projects/${projectId}/material-usage`} label="Material Requirements" />
        </CardContent>
      </Card>
    </div>
  );
}

const Go = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50">{label}<ArrowRight className="h-4 w-4 text-muted-foreground" /></Link>
);

function Step({ ok, icon, title, text }: { ok: boolean; icon: React.ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", ok ? "bg-green-500/10 text-green-600" : "bg-muted text-muted-foreground")}>{icon}</span>
      <div className="min-w-0"><p className="font-medium">{title}</p><p className="text-xs text-muted-foreground">{text}</p></div>
    </li>
  );
}

function Note({ tone, text }: { tone: "bad" | "warn"; text: string }) {
  const Icon = tone === "bad" ? XCircle : AlertTriangle;
  return <div className={cn("flex items-start gap-2 rounded-md border p-2.5 text-sm", tone === "bad" ? "border-red-500/30 bg-red-500/10 text-red-700" : "border-amber-500/40 bg-amber-500/10 text-amber-700")}><Icon className="mt-0.5 h-4 w-4 shrink-0" /><span>{text}</span></div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
