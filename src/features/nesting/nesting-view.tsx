"use client";
import * as React from "react";
import {
  Plus, FolderKanban, Boxes, Trash2, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, XCircle, Loader2, Play, Layers, Scissors, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import type { NestingJobRow, NestingJobDetail, NestingRunDetail } from "./types";
import { useTakeoffProject } from "@/features/takeoff/project-context";
import { NestingSheetPreview, type PartBBoxInfo } from "./nesting-sheet-preview";

function fmt(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function NestingView({ canCreate, canDelete }: { canCreate: boolean; canDelete: boolean }) {
  const { projects, projectId } = useTakeoffProject();
  const [jobs, setJobs] = React.useState<NestingJobRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  const [deletingJob, setDeletingJob] = React.useState<NestingJobRow | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  const loadJobs = React.useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    const res = await fetch(`/api/nesting/jobs?projectId=${pid}`);
    setJobs(res.ok ? await res.json() : []);
    setLoading(false);
  }, []);

  React.useEffect(() => { loadJobs(projectId); }, [projectId, loadJobs]);

  // There's no "job name" for the user to give — a project has exactly one
  // Nesting, so starting it is a single click with no form.
  async function handleStart() {
    setStarting(true);
    const res = await fetch("/api/nesting/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, name: "Nesting" }),
    });
    setStarting(false);
    if (!res.ok) { toast.error("Failed to start nesting"); return; }
    toast.success("Nesting started");
    loadJobs(projectId);
  }

  async function handleUpdateNesting() {
    setLoading(true);
    await loadJobs(projectId);
    toast.success("Nesting updated with the latest parts from Standard Calculations");
  }

  async function handleDeleteJob() {
    if (!deletingJob) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/nesting/jobs/${deletingJob.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) { toast.error("Failed to delete nesting"); return; }
    toast.success("Nesting deleted");
    setDeletingJob(null);
    loadJobs(projectId);
  }

  const selectedProject = projects.find((p) => p.id === projectId);
  const currentJob = jobs[0]; // enforced: at most one Nesting per project

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        {canCreate && (
          currentJob ? (
            <div className="flex items-center gap-2">
              <Button onClick={handleUpdateNesting} disabled={!projectId || loading} variant="outline">
                <Boxes className="h-4 w-4" /> Update Nesting
              </Button>
              {canDelete && (
                <Button onClick={() => setDeletingJob(currentJob)} variant="ghost" size="icon" title="Delete nesting">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              )}
            </div>
          ) : (
            <Button onClick={handleStart} disabled={!projectId || starting}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Start Nesting
            </Button>
          )
        )}
      </div>

      {!projectId ? (
        <EmptyState icon={<FolderKanban className="h-5 w-5" />} title="No project selected" description="Choose a project above to see its nesting." />
      ) : loading ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : !currentJob ? (
        <EmptyState
          icon={<Boxes className="h-5 w-5" />}
          title="No nesting yet"
          description={`Start nesting for ${selectedProject?.number ?? "this project"} — it will automatically collect every DXF-ready part from Standard Calculations.`}
          action={canCreate ? <Button onClick={handleStart} disabled={starting}>{starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Start Nesting</Button> : undefined}
        />
      ) : (
        <NestingJobCard job={currentJob} onChanged={() => loadJobs(projectId)} />
      )}

      <ConfirmDialog
        open={!!deletingJob}
        onOpenChange={(v) => !v && setDeletingJob(null)}
        title="Delete nesting?"
        description={`This will remove this project's nesting and its declared source sheets. The underlying parts (and their DXF files) in Standard Calculations are not affected.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={handleDeleteJob}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// One job card. Detail (eligible/excluded/groups/coverage) is fetched lazily
// on first expand and refetched whenever sources change — never guessed
// client-side, always the server's `getEligibleNestingParts` result.
// ----------------------------------------------------------------------------

function NestingJobCard({
  job, onChanged,
}: {
  job: NestingJobRow;
  onChanged: () => void;
}) {
  const [detail, setDetail] = React.useState<NestingJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [showExcluded, setShowExcluded] = React.useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = React.useState(false);

  const [running, setRunning] = React.useState(false);
  const [activeRun, setActiveRun] = React.useState<NestingRunDetail | null>(null);
  const [runLoading, setRunLoading] = React.useState(false);
  const [downloadingDxf, setDownloadingDxf] = React.useState(false);

  // Nesting Parameters (PROJECT.md §5/§20) — configurable per run, never
  // hard-coded. Defaults match the engine's own DEFAULT_ENGINE_CONFIG.
  const [partGapMm, setPartGapMm] = React.useState("0");
  const [marginLeftMm, setMarginLeftMm] = React.useState("25");
  const [marginRightMm, setMarginRightMm] = React.useState("25");
  const [marginTopMm, setMarginTopMm] = React.useState("25");
  const [marginBottomMm, setMarginBottomMm] = React.useState("25");

  const loadDetail = React.useCallback(async () => {
    setDetailLoading(true);
    const res = await fetch(`/api/nesting/jobs/${job.id}`);
    if (res.ok) setDetail(await res.json());
    setDetailLoading(false);
  }, [job.id]);

  const loadRun = React.useCallback(async (runId: string) => {
    setRunLoading(true);
    const res = await fetch(`/api/nesting/runs/${runId}`);
    if (res.ok) setActiveRun(await res.json());
    setRunLoading(false);
  }, []);

  React.useEffect(() => {
    if (!detail) loadDetail();
  }, [detail, loadDetail]);

  // Once job detail loads, show the most recent run's results (if any)
  // without requiring the user to click Run Nesting again after reopening
  // the job.
  React.useEffect(() => {
    if (detail && detail.runs.length > 0 && !activeRun && !runLoading) {
      loadRun(detail.runs[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const partGap = Number(partGapMm) || 0;
  const marginLeft = Number(marginLeftMm) || 0;
  const marginRight = Number(marginRightMm) || 0;
  const marginTop = Number(marginTopMm) || 0;
  const marginBottom = Number(marginBottomMm) || 0;

  const nestingParamsInvalid =
    partGap < 0 || marginLeft < 0 || marginRight < 0 || marginTop < 0 || marginBottom < 0 ||
    (detail?.sources.some((s) => marginLeft + marginRight >= s.widthMm || marginTop + marginBottom >= s.lengthMm) ?? false);

  async function handleRunNesting() {
    if (running || nestingParamsInvalid) return; // prevent duplicate clicks / invalid config
    setRunning(true);
    try {
      const res = await fetch(`/api/nesting/jobs/${job.id}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partGapMm: partGap,
          marginLeftMm: marginLeft,
          marginRightMm: marginRight,
          marginTopMm: marginTop,
          marginBottomMm: marginBottom,
        }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(typeof body?.error === "string" ? body.error : "Nesting run failed");
        return;
      }
      const run = body as NestingRunDetail;
      setActiveRun(run);
      if ((run.totalPartsUnplaced ?? 0) > 0) {
        toast.warning(`Nesting completed with ${run.totalPartsUnplaced} unplaced part${run.totalPartsUnplaced === 1 ? "" : "s"}.`);
      } else {
        toast.success(`Nesting completed: ${run.totalPartsPlaced}/${run.totalPartsRequired} parts placed on ${run.totalSheets} sheet(s).`);
      }
      await loadDetail();
    } catch {
      toast.error("Nesting run failed");
    } finally {
      setRunning(false);
    }
  }

  async function handleDownloadDxf() {
    if (!activeRun || downloadingDxf) return;
    setDownloadingDxf(true);
    try {
      const res = await fetch(`/api/nesting/runs/${activeRun.id}/dxf`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(typeof body?.error === "string" ? body.error : "Failed to generate DXF");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] ?? `Nesting_Run_${activeRun.id}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to generate DXF");
    } finally {
      setDownloadingDxf(false);
    }
  }

  async function handleRemoveSource(sourceId: string) {
    const res = await fetch(`/api/nesting/jobs/${job.id}/sources/${sourceId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to remove source"); return; }
    loadDetail();
    onChanged();
  }

  const allCovered = detail ? detail.coverage.length > 0 && detail.coverage.every((c) => c.covered) : false;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Boxes className="h-4 w-4 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            {job.partsSummary.totalParts} Parts · {job.partsSummary.totalPcs} pcs · {job.partsSummary.groupCount} group{job.partsSummary.groupCount === 1 ? "" : "s"}
            {job.partsSummary.excludedCount > 0 && (
              <span className="ml-1 text-amber-600">· {job.partsSummary.excludedCount} excluded</span>
            )}
            {"  ·  "}
            {job.sources.length === 0 ? "Sources not configured" : `${job.sources.length} source${job.sources.length === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      <div className="divide-y divide-border">
          {detailLoading && !detail ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading job details…</div>
          ) : !detail ? (
            <div className="px-4 py-8 text-center text-sm text-destructive">Failed to load job details.</div>
          ) : (
            <>
              {/* PARTS TO NEST */}
              <div className="px-4 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">Parts to Nest</h4>
                    <p className="text-xs text-muted-foreground">Automatically collected from Standard Calculations</p>
                  </div>
                  <span className="text-xs font-medium text-foreground">
                    {detail.eligible.totalParts} parts · {detail.eligible.totalPcs} pcs
                  </span>
                </div>
                {detail.eligible.included.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    No eligible parts yet. Upload valid DXF files to parts in Standard Calculations.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                          <th className="px-3 py-1.5 font-medium">Item</th>
                          <th className="px-3 py-1.5 font-medium">Description</th>
                          <th className="px-3 py-1.5 font-medium">Drawing</th>
                          <th className="px-3 py-1.5 font-medium">Material</th>
                          <th className="px-3 py-1.5 text-right font-medium">Thk (mm)</th>
                          <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                          <th className="px-3 py-1.5 text-right font-medium">DXF Area (m²)</th>
                          <th className="px-3 py-1.5 text-center font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.eligible.included.map((p) => (
                          <tr key={p.id} className="border-b border-border last:border-0">
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.itemNo}</td>
                            <td className="px-3 py-1.5">{p.description}</td>
                            <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.drawing.drawingNumber}</td>
                            <td className="px-3 py-1.5">{p.material}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{p.thicknessMm}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{p.qty}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{p.dxfAreaSqm?.toFixed(3) ?? "—"}</td>
                            <td className="px-3 py-1.5 text-center">
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
                                <CheckCircle2 className="h-3 w-3" /> Included
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* EXCLUDED PARTS */}
              <div className="px-4 py-4">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => setShowExcluded((v) => !v)}
                >
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">Excluded from Nesting</h4>
                    {detail.eligible.excluded.length > 0 && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                        {detail.eligible.excluded.length}
                      </span>
                    )}
                  </div>
                  {showExcluded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </button>
                {showExcluded && (
                  detail.eligible.excluded.length === 0 ? (
                    <p className="mt-2 text-xs text-muted-foreground">Nothing excluded — every part in this project is nesting-ready.</p>
                  ) : (
                    <div className="mt-2 overflow-x-auto rounded-lg border border-border">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                            <th className="px-3 py-1.5 font-medium">Item</th>
                            <th className="px-3 py-1.5 font-medium">Description</th>
                            <th className="px-3 py-1.5 font-medium">Drawing</th>
                            <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                            <th className="px-3 py-1.5 font-medium">Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.eligible.excluded.map((p) => (
                            <tr key={p.id} className="border-b border-border last:border-0">
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.itemNo}</td>
                              <td className="px-3 py-1.5">{p.description}</td>
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">{p.drawing.drawingNumber}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{p.qty}</td>
                              <td className="px-3 py-1.5">
                                <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive" title={p.detail ?? undefined}>
                                  <XCircle className="h-3 w-3" /> {p.reason}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                )}
              </div>

              {/* NESTING GROUPS */}
              <div className="px-4 py-4">
                <h4 className="mb-2 text-sm font-semibold text-foreground">Nesting Groups</h4>
                {detail.eligible.groups.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No groups yet — add eligible parts first.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {detail.eligible.groups.map((g) => (
                      <div key={g.key} className="rounded-lg border border-border p-3">
                        <p className="text-xs font-semibold text-foreground">
                          {g.material} — {g.thicknessMm} mm
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{g.partCount} parts · {g.totalPcs} pcs</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Grouped by material + thickness, resolved per part from Standard Calculations.
                </p>
              </div>

              {/* SOURCE MATERIAL */}
              <div className="px-4 py-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Source Material</h4>
                  <Button size="sm" variant="outline" onClick={() => setSourceDialogOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> Add Source
                  </Button>
                </div>
                {detail.sources.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    No source sheets declared yet.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {detail.sources.map((s, i) => (
                      <div key={s.id} className="flex items-start justify-between rounded-lg border border-border p-3">
                        <div>
                          <p className="text-xs font-semibold text-foreground">Source #{i + 1}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {s.material} · {s.thicknessMm} mm<br />
                            {fmt(s.widthMm, 0)} × {fmt(s.lengthMm, 0)} mm<br />
                            <span className="text-emerald-600">Available for Purchase</span>
                            {s.availableQty != null && ` · ${s.availableQty} in stock`}
                          </p>
                        </div>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleRemoveSource(s.id)} title="Remove source">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* SOURCE COVERAGE */}
              <div className="px-4 py-4">
                <h4 className="mb-2 text-sm font-semibold text-foreground">Source Coverage</h4>
                {detail.coverage.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing to cover yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {detail.coverage.map((c) => (
                      <div key={c.key} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                        <span className="font-medium text-foreground">{c.material} / {c.thicknessMm} mm</span>
                        <span className="text-muted-foreground">Required: {c.totalPcs} pcs</span>
                        {c.covered ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Covered</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> Missing Source</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* NESTING PARAMETERS */}
              <div className="px-4 py-4">
                <h4 className="mb-2 text-sm font-semibold text-foreground">Nesting Parameters</h4>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div className="space-y-1.5">
                    <Label>Part Gap (mm)</Label>
                    <Input type="number" step="any" min={0} value={partGapMm} onChange={(e) => setPartGapMm(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Left Margin (mm)</Label>
                    <Input type="number" step="any" min={0} value={marginLeftMm} onChange={(e) => setMarginLeftMm(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Right Margin (mm)</Label>
                    <Input type="number" step="any" min={0} value={marginRightMm} onChange={(e) => setMarginRightMm(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Top Margin (mm)</Label>
                    <Input type="number" step="any" min={0} value={marginTopMm} onChange={(e) => setMarginTopMm(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Bottom Margin (mm)</Label>
                    <Input type="number" step="any" min={0} value={marginBottomMm} onChange={(e) => setMarginBottomMm(e.target.value)} />
                  </div>
                </div>
                {detail.sources.length > 0 && (
                  <div className="mt-3 space-y-1">
                    <p className="text-[11px] font-medium text-muted-foreground">Effective usable nesting area (updates live):</p>
                    {detail.sources.map((s) => {
                      const usableW = s.widthMm - marginLeft - marginRight;
                      const usableH = s.lengthMm - marginTop - marginBottom;
                      const invalid = usableW <= 0 || usableH <= 0;
                      return (
                        <p key={s.id} className={`text-[11px] ${invalid ? "text-destructive" : "text-muted-foreground"}`}>
                          {s.material} {s.thicknessMm}mm — {fmt(s.widthMm, 0)}×{fmt(s.lengthMm, 0)} mm sheet → usable {invalid ? "INVALID (margins too large)" : `${fmt(usableW, 0)}×${fmt(usableH, 0)} mm`}
                        </p>
                      );
                    })}
                  </div>
                )}
                {nestingParamsInvalid && (
                  <p className="mt-2 text-[11px] font-medium text-destructive">
                    Fix the parameters above — values cannot be negative and margins cannot exceed a source sheet&apos;s own dimensions.
                  </p>
                )}
              </div>

              {/* RUN NESTING */}
              <div className="flex items-center justify-between bg-muted/10 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Runs the deterministic bottom-left / first-fit nesting engine against the parts and source sheets above.
                </p>
                <Button
                  disabled={!allCovered || running || nestingParamsInvalid}
                  title={allCovered ? "Run the nesting engine" : "All groups need compatible source material first"}
                  onClick={handleRunNesting}
                >
                  {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  {running ? "Running…" : "Run Nesting"}
                </Button>
              </div>

              {/* NESTING RESULTS */}
              {runLoading && !activeRun ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">Loading last run…</div>
              ) : activeRun ? (
                <NestingResults run={activeRun} eligible={detail.eligible} onDownloadDxf={handleDownloadDxf} downloadingDxf={downloadingDxf} />
              ) : null}
            </>
          )}
      </div>

      <AddSourceDialog
        open={sourceDialogOpen}
        onOpenChange={setSourceDialogOpen}
        jobId={job.id}
        defaultMaterial={job.material}
        defaultThicknessMm={job.thicknessMm}
        onAdded={() => { loadDetail(); onChanged(); }}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Nesting results — summary, per-material-group breakdown, per-sheet stats,
// unplaced parts, and the SVG sheet preview (PROJECT.md §17-18). Renders
// directly from a NestingRunDetail; never computes its own numbers.
// ----------------------------------------------------------------------------

function NestingResults({
  run, eligible, onDownloadDxf, downloadingDxf,
}: {
  run: NestingRunDetail;
  eligible: NestingJobDetail["eligible"];
  onDownloadDxf: () => void;
  downloadingDxf: boolean;
}) {
  const [expandedSheetId, setExpandedSheetId] = React.useState<string | null>(null);

  const partInfoById = React.useMemo(() => {
    const map = new Map<string, PartBBoxInfo>();
    for (const p of eligible.included) {
      map.set(p.id, { itemNo: p.itemNo, bboxWidthMm: p.bboxWidthMm, bboxHeightMm: p.bboxHeightMm });
    }
    return map;
  }, [eligible]);

  // Group sheets by material + thickness for the "Material Groups" table.
  const groups = React.useMemo(() => {
    const map = new Map<string, { material: string; thicknessMm: number; sheets: typeof run.sheets; parts: number; usedArea: number; scrapArea: number }>();
    for (const sheet of run.sheets) {
      const key = `${sheet.material}||${sheet.thicknessMm}`;
      const entry = map.get(key) ?? { material: sheet.material, thicknessMm: sheet.thicknessMm, sheets: [], parts: 0, usedArea: 0, scrapArea: 0 };
      entry.sheets.push(sheet);
      entry.parts += sheet.placements.length;
      entry.usedArea += sheet.usedAreaSqm ?? 0;
      entry.scrapArea += sheet.scrapAreaSqm ?? 0;
      map.set(key, entry);
    }
    return [...map.values()];
  }, [run]);

  if (run.status === "FAILED") {
    return (
      <div className="px-4 py-4">
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-3 text-xs text-destructive">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Nesting run failed</p>
            <p className="mt-0.5 text-destructive/90">{run.errorMessage ?? "Unknown error"}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-4">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-foreground">Nesting Results</h4>
        {run.sheets.length > 0 && (
          <Button size="sm" variant="outline" onClick={onDownloadDxf} disabled={downloadingDxf}>
            {downloadingDxf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {run.sheets.length > 1 ? "Download All DXFs" : "Download DXF"}
          </Button>
        )}
      </div>

      {/* SUMMARY */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryStat label="Parts Required" value={String(run.totalPartsRequired ?? 0)} />
        <SummaryStat label="Parts Placed" value={String(run.totalPartsPlaced ?? 0)} />
        <SummaryStat
          label="Parts Unplaced"
          value={String(run.totalPartsUnplaced ?? 0)}
          tone={(run.totalPartsUnplaced ?? 0) > 0 ? "warning" : "default"}
        />
        <SummaryStat label="Sheets Used" value={String(run.totalSheets ?? 0)} />
        <SummaryStat label="Utilization" value={`${fmt(run.overallUtilizationPercent ?? 0, 1)}%`} />
        <SummaryStat label="Scrap" value={`${fmt(run.totalScrapAreaSqm ?? 0, 2)} m²`} />
      </div>

      {/* SOURCE MATERIAL REQUIREMENT — the automatically-calculated purchasing
          answer (PROJECT.md §16/§23): "buy N sheets of W×L×T material". */}
      {run.sourceRequirementJson && run.sourceRequirementJson.length > 0 && (
        <div className="mt-4">
          <h5 className="mb-1.5 text-xs font-semibold text-foreground">Source Material Requirement</h5>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-1.5 font-medium">Material</th>
                  <th className="px-3 py-1.5 text-right font-medium">Thickness</th>
                  <th className="px-3 py-1.5 font-medium">Sheet Size</th>
                  <th className="px-3 py-1.5 text-right font-medium">Required Qty</th>
                </tr>
              </thead>
              <tbody>
                {run.sourceRequirementJson.map((r) => (
                  <tr key={r.sourceSheetId} className="border-b border-border last:border-0">
                    <td className="px-3 py-1.5">{r.material}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.thicknessMm} mm</td>
                    <td className="px-3 py-1.5">{fmt(r.widthMm, 0)} × {fmt(r.lengthMm, 0)} mm</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{r.requiredQty} Sheet{r.requiredQty === 1 ? "" : "s"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            To manufacture all required parts, purchase the quantities above — the engine calculated this automatically from the nesting result.
          </p>
        </div>
      )}

      {/* UNPLACED PARTS */}
      {run.unplacedPartsJson && run.unplacedPartsJson.length > 0 && (
        <div className="mt-4 overflow-x-auto rounded-lg border border-amber-500/30">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-amber-500/30 bg-amber-500/10 text-left text-xs text-amber-800">
                <th className="px-3 py-1.5 font-medium">Item</th>
                <th className="px-3 py-1.5 text-right font-medium">Required</th>
                <th className="px-3 py-1.5 text-right font-medium">Placed</th>
                <th className="px-3 py-1.5 text-right font-medium">Remaining</th>
                <th className="px-3 py-1.5 font-medium">Reason</th>
              </tr>
            </thead>
            <tbody>
              {run.unplacedPartsJson.map((u) => (
                <tr key={u.takeoffPartId} className="border-b border-amber-500/20 last:border-0">
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">#{u.itemNo}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{u.requiredQty}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{u.placedQty}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-amber-700">{u.remainingQty}</td>
                  <td className="px-3 py-1.5 text-xs">{u.reason.replaceAll("_", " ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MATERIAL GROUPS */}
      {groups.length > 0 && (
        <div className="mt-4">
          <h5 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground"><Layers className="h-3.5 w-3.5" /> Material Groups</h5>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => {
              const total = g.usedArea + g.scrapArea;
              const util = total > 0 ? (g.usedArea / total) * 100 : 0;
              return (
                <div key={`${g.material}||${g.thicknessMm}`} className="rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-foreground">{g.material} — {g.thicknessMm} mm</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {g.parts} parts · {g.sheets.length} sheet{g.sheets.length === 1 ? "" : "s"} · {fmt(util, 1)}% util · {fmt(g.scrapArea, 2)} m² scrap
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SHEETS */}
      {run.sheets.length > 0 && (
        <div className="mt-4">
          <h5 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground"><Scissors className="h-3.5 w-3.5" /> Sheets</h5>
          <div className="space-y-2">
            {run.sheets.map((sheet) => {
              const isOpen = expandedSheetId === sheet.id;
              return (
                <div key={sheet.id} className="overflow-hidden rounded-lg border border-border">
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center justify-between gap-2 bg-muted/20 px-3 py-2 text-left text-xs"
                    onClick={() => setExpandedSheetId(isOpen ? null : sheet.id)}
                  >
                    <span className="font-medium text-foreground">
                      Sheet #{sheet.sheetNumber} — {sheet.material} {sheet.thicknessMm}mm — {fmt(sheet.widthMm, 0)}×{fmt(sheet.lengthMm, 0)} mm
                    </span>
                    <span className="text-muted-foreground">
                      {sheet.placements.length} parts · {fmt(sheet.utilizationPercent ?? 0, 1)}% util · {fmt(sheet.scrapAreaSqm ?? 0, 2)} m² scrap
                    </span>
                    {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                  </button>
                  {isOpen && (
                    <div className="p-3">
                      <NestingSheetPreview sheet={sheet} partInfoById={partInfoById} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" }) {
  return (
    <div className="rounded-lg border border-border p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${tone === "warning" ? "text-amber-600" : "text-foreground"}`}>{value}</p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Add Source dialog — the one genuinely manual input in this workflow.
// ----------------------------------------------------------------------------

function AddSourceDialog({
  open, onOpenChange, jobId, defaultMaterial, defaultThicknessMm, onAdded,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  defaultMaterial: string | null;
  defaultThicknessMm: number | null;
  onAdded: () => void;
}) {
  const [material, setMaterial] = React.useState("");
  const [thicknessMm, setThicknessMm] = React.useState("");
  const [widthMm, setWidthMm] = React.useState("");
  const [lengthMm, setLengthMm] = React.useState("");
  const [availableQty, setAvailableQty] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setMaterial(defaultMaterial ?? "");
      setThicknessMm(defaultThicknessMm != null ? String(defaultThicknessMm) : "");
      setWidthMm("");
      setLengthMm("");
      setAvailableQty("");
    }
  }, [open, defaultMaterial, defaultThicknessMm]);

  async function handleSubmit() {
    if (!material.trim()) { toast.error("Material is required"); return; }
    const thickness = Number(thicknessMm);
    const width = Number(widthMm);
    const length = Number(lengthMm);
    const qty = Number(availableQty);
    if (!(thickness > 0)) { toast.error("Thickness must be greater than 0"); return; }
    if (!(width > 0)) { toast.error("Width must be greater than 0"); return; }
    if (!(length > 0)) { toast.error("Length must be greater than 0"); return; }

    setSubmitting(true);
    const res = await fetch(`/api/nesting/jobs/${jobId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        material: material.trim(),
        thicknessMm: thickness,
        widthMm: width,
        lengthMm: length,
        // Stock on hand is optional and purely informational (PROJECT.md
        // §2/§4/§21) — a Source Sheet is a purchasable size, not a fixed
        // quantity, so this is never required before nesting can run.
        availableQty: qty > 0 ? qty : undefined,
      }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error?.formErrors?.[0] ?? "Failed to add source");
      return;
    }
    toast.success("Source sheet added");
    onOpenChange(false);
    onAdded();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add Source Sheet</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Material</Label>
            <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. Steel" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Thickness (mm)</Label>
              <Input type="number" step="any" value={thicknessMm} onChange={(e) => setThicknessMm(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Stock on hand (optional)</Label>
              <Input type="number" step="1" value={availableQty} onChange={(e) => setAvailableQty(e.target.value)} placeholder="Available for Purchase" />
              <p className="text-[11px] text-muted-foreground">
                Leave blank — sheets of this size are available for purchase, not a fixed inventory. The nesting engine will calculate how many to buy.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Width (mm)</Label>
              <Input type="number" step="any" value={widthMm} onChange={(e) => setWidthMm(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Length (mm)</Label>
              <Input type="number" step="any" value={lengthMm} onChange={(e) => setLengthMm(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
