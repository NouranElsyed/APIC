"use client";
import * as React from "react";
import { Download, Loader2, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { toast } from "sonner";
import { useTakeoffProject } from "@/features/takeoff/project-context";
import type { NestingJobRow, NestingJobDetail, NestingRunSummary } from "@/features/nesting/types";
import type { ScrapPricingResult, ScrapPricingGlobalInputs } from "./types";

function fmt(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pct(n: number, digits = 1) {
  return `${fmt(n * 100, digits)}%`;
}

const DEFAULT_INPUTS: ScrapPricingGlobalInputs = {
  costPerKg: 46,
  usedLaterPct: 0,
  usedLaterPriceLEPerKg: 46,
  scrapSellPriceLEPerKg: 15, // configurable default per spec — never hard-coded downstream
};

export function ScrapPricingView({ canExport }: { canExport: boolean }) {
  const { projectId, projects } = useTakeoffProject();
  const selectedProject = projects.find((p) => p.id === projectId);

  const [jobs, setJobs] = React.useState<NestingJobRow[]>([]);
  const [jobId, setJobId] = React.useState("");
  const [runs, setRuns] = React.useState<NestingRunSummary[]>([]);
  const [runId, setRunId] = React.useState("");

  const [inputs, setInputs] = React.useState<ScrapPricingGlobalInputs>(DEFAULT_INPUTS);
  const [result, setResult] = React.useState<ScrapPricingResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    setJobId(""); setRuns([]); setRunId(""); setResult(null);
    if (!projectId) { setJobs([]); return; }
    fetch(`/api/nesting/jobs?projectId=${projectId}`).then((r) => r.json()).then(setJobs);
  }, [projectId]);

  React.useEffect(() => {
    setRunId(""); setResult(null);
    if (!jobId) { setRuns([]); return; }
    fetch(`/api/nesting/jobs/${jobId}`).then((r) => r.json()).then((detail: NestingJobDetail) => {
      setRuns((detail.runs ?? []).filter((r) => r.status === "COMPLETED"));
    });
  }, [jobId]);

  React.useEffect(() => { setResult(null); }, [runId]);

  const calculate = React.useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    const res = await fetch("/api/scrap-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nestingRunId: runId, ...inputs }),
    });
    setLoading(false);
    if (!res.ok) { toast.error("Failed to calculate scrap & material pricing"); return; }
    setResult(await res.json());
  }, [runId, inputs]);

  async function handleExport() {
    if (!runId || !projectId) return;
    setExporting(true);
    const res = await fetch("/api/scrap-pricing/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nestingRunId: runId, projectId, ...inputs }),
    });
    setExporting(false);
    if (!res.ok) { toast.error("Failed to export"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `SteelFlow_Scrap_Pricing_${selectedProject?.number ?? "project"}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Exported");
  }

  if (!projectId) {
    return <EmptyState icon={<Boxes className="h-5 w-5" />} title="No project selected" description="Choose a project above to calculate scrap & material pricing." />;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Nesting Job</Label>
          <Select value={jobId} onValueChange={setJobId}>
            <SelectTrigger><SelectValue placeholder="Select a nesting job" /></SelectTrigger>
            <SelectContent>
              {jobs.map((j) => <SelectItem key={j.id} value={j.id}>{j.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Nesting Run</Label>
          <Select value={runId} onValueChange={setRunId} disabled={!jobId}>
            <SelectTrigger><SelectValue placeholder={runs.length ? "Select a completed run" : "No completed runs yet"} /></SelectTrigger>
            <SelectContent>
              {runs.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {new Date(r.createdAt).toLocaleString()} — {r.totalSheets ?? 0} sheets, {fmt(r.overallUtilizationPercent ?? 0, 1)}% util
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {runId && (
        <div className="space-y-4 rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Pricing inputs — the only manually-entered values; everything else is calculated from the nesting result.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Cost/kg (LE)</Label>
              <Input type="number" step="any" value={inputs.costPerKg}
                onChange={(e) => setInputs((s) => ({ ...s, costPerKg: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>% Used Later</Label>
              <Input type="number" step="any" min={0} max={100} value={inputs.usedLaterPct * 100}
                onChange={(e) => setInputs((s) => ({ ...s, usedLaterPct: Number(e.target.value) / 100 }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Used Later Price (LE/kg)</Label>
              <Input type="number" step="any" value={inputs.usedLaterPriceLEPerKg}
                onChange={(e) => setInputs((s) => ({ ...s, usedLaterPriceLEPerKg: Number(e.target.value) }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Scrap Selling Price (LE/kg)</Label>
              <Input type="number" step="any" value={inputs.scrapSellPriceLEPerKg}
                onChange={(e) => setInputs((s) => ({ ...s, scrapSellPriceLEPerKg: Number(e.target.value) }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {canExport && (
              <Button variant="outline" onClick={handleExport} disabled={exporting || !result}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export to Excel
              </Button>
            )}
            <Button onClick={calculate} disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Calculate
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Used Area" value={`${fmt(result.totals.totalUsedAreaSqm, 3)} m²`} />
            <Stat label="Used Weight" value={`${fmt(result.totals.totalUsedWeightKg, 1)} kg`} />
            <Stat label="Buy Weight" value={`${fmt(result.totals.totalBuyWeightKg, 1)} kg`} />
            <Stat label="Used Later" value={`${fmt(result.totals.totalWeightUsedLaterKg, 1)} kg`} />
            <Stat label="Actual Scrap" value={`${fmt(result.totals.totalActualScrapWeightKg, 1)} kg`} />
            <Stat label="Buy Cost" value={`${fmt(result.totals.totalBuyCostLE, 0)} LE`} />
            <Stat label="Used Later Value" value={`${fmt(result.totals.totalUsedLaterValueLE, 0)} LE`} />
            <Stat label="Scrap Value" value={`${fmt(result.totals.totalScrapValueLE, 0)} LE`} />
            <Stat label="Scrap % (Bought)" value={pct(result.totals.actualScrapPctFromBought)} />
            <Stat label="Scrap % (Used)" value={pct(result.totals.actualScrapPctFromUsed)} />
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="px-3 py-2 text-right font-medium">Used Area (m²)</th>
                  <th className="px-3 py-2 text-right font-medium">Used Wt (kg)</th>
                  <th className="px-3 py-2 text-right font-medium">Buy Qty</th>
                  <th className="px-3 py-2 text-right font-medium">Buy Wt (kg)</th>
                  <th className="px-3 py-2 text-right font-medium">Primary Scrap %</th>
                  <th className="px-3 py-2 text-right font-medium">Used Later Wt</th>
                  <th className="px-3 py-2 text-right font-medium">Used Later Value</th>
                  <th className="px-3 py-2 text-right font-medium">Actual Scrap Wt</th>
                  <th className="px-3 py-2 text-right font-medium">Scrap Value</th>
                  <th className="px-3 py-2 text-right font-medium">Buy Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Actual Scrap %</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium text-foreground">{r.itemLabel}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.usedAreaSqm, 3)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.usedWeightKg, 1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.buyQty}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.buyWeightKg, 1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(r.primaryScrapPct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.weightUsedLaterKg, 1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.usedLaterValueLE, 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.actualScrapWeightKg, 1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.scrapValueLE, 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.buyCostLE, 0)}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.actualScrapPct < 0 ? "text-emerald-600" : "text-foreground"}`}>{pct(r.actualScrapPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold text-foreground">{value}</p>
    </div>
  );
}
