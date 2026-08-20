"use client";
import * as React from "react";
import Link from "next/link";
import {
  Plus, FolderKanban, Boxes, Trash2, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, XCircle, Loader2, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import type { NestingJobRow, NestingJobDetail } from "./types";
import type { ProjectOption } from "@/features/takeoff/types";

function fmt(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function NestingView({ canCreate, canDelete }: { canCreate: boolean; canDelete: boolean }) {
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = React.useState("");
  const [jobs, setJobs] = React.useState<NestingJobRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [material, setMaterial] = React.useState("");
  const [thicknessMm, setThicknessMm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const [deletingJob, setDeletingJob] = React.useState<NestingJobRow | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((data) => {
      setProjects(data);
      if (data.length > 0) setProjectId((prev) => prev || data[0].id);
    });
  }, []);

  const loadJobs = React.useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    const res = await fetch(`/api/nesting/jobs?projectId=${pid}`);
    setJobs(res.ok ? await res.json() : []);
    setLoading(false);
  }, []);

  React.useEffect(() => { loadJobs(projectId); }, [projectId, loadJobs]);

  async function handleCreate() {
    if (!name.trim()) { toast.error("Job name is required"); return; }
    setSubmitting(true);
    const res = await fetch("/api/nesting/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        name: name.trim(),
        material: material.trim() || null,
        thicknessMm: thicknessMm.trim() ? Number(thicknessMm) : null,
      }),
    });
    setSubmitting(false);
    if (!res.ok) { toast.error("Failed to create nesting job"); return; }
    toast.success("Nesting job created");
    setCreateOpen(false);
    setName(""); setMaterial(""); setThicknessMm("");
    loadJobs(projectId);
  }

  async function handleDeleteJob() {
    if (!deletingJob) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/nesting/jobs/${deletingJob.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) { toast.error("Failed to delete job"); return; }
    toast.success("Nesting job deleted");
    setDeletingJob(null);
    loadJobs(projectId);
  }

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-border">
        <Link href="/takeoff" className="px-1 pb-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
          Standard Calculations
        </Link>
        <div className="border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground">DXF Nesting</div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div className="min-w-72">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Project</label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue placeholder="Select a project" /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.number} — {p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setCreateOpen(true)} disabled={!projectId}>
            <Plus className="h-4 w-4" /> New Nesting Job
          </Button>
        )}
      </div>

      {!projectId ? (
        <EmptyState icon={<FolderKanban className="h-5 w-5" />} title="No project selected" description="Choose a project above to see its nesting jobs." />
      ) : loading ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-5 w-5" />}
          title="No nesting jobs yet"
          description={`Create the first nesting job for ${selectedProject?.number ?? "this project"} — it will automatically collect every DXF-ready part from Standard Calculations.`}
          action={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Nesting Job</Button> : undefined}
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <NestingJobCard
              key={job.id}
              job={job}
              isExpanded={expandedId === job.id}
              onToggle={() => setExpandedId(expandedId === job.id ? null : job.id)}
              canDelete={canDelete}
              onRequestDelete={() => setDeletingJob(job)}
              onChanged={() => loadJobs(projectId)}
            />
          ))}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New Nesting Job</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Job name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Job #001 — Riser plates" autoFocus />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Material (optional)</Label>
                <Input value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. Steel" />
              </div>
              <div className="space-y-1.5">
                <Label>Thickness mm (optional)</Label>
                <Input type="number" step="any" value={thicknessMm} onChange={(e) => setThicknessMm(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              You won&apos;t select parts manually — every DXF-ready part in this project is collected automatically once the job is created.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="button" onClick={handleCreate} disabled={submitting}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingJob}
        onOpenChange={(v) => !v && setDeletingJob(null)}
        title="Delete nesting job?"
        description={`This will remove "${deletingJob?.name}" and its declared source sheets. The underlying parts (and their DXF files) in Standard Calculations are not affected.`}
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
  job, isExpanded, onToggle, canDelete, onRequestDelete, onChanged,
}: {
  job: NestingJobRow;
  isExpanded: boolean;
  onToggle: () => void;
  canDelete: boolean;
  onRequestDelete: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = React.useState<NestingJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [showExcluded, setShowExcluded] = React.useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = React.useState(false);

  const loadDetail = React.useCallback(async () => {
    setDetailLoading(true);
    const res = await fetch(`/api/nesting/jobs/${job.id}`);
    if (res.ok) setDetail(await res.json());
    setDetailLoading(false);
  }, [job.id]);

  React.useEffect(() => {
    if (isExpanded && !detail) loadDetail();
  }, [isExpanded, detail, loadDetail]);

  async function handleRemoveSource(sourceId: string) {
    const res = await fetch(`/api/nesting/jobs/${job.id}/sources/${sourceId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to remove source"); return; }
    loadDetail();
    onChanged();
  }

  const allCovered = detail ? detail.coverage.length > 0 && detail.coverage.every((c) => c.covered) : false;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <button
        type="button"
        className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3 text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2.5">
          {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          <Boxes className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              {job.name}
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{job.status}</span>
            </p>
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
        {canDelete && (
          <span
            role="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); onRequestDelete(); }}
          >
            <Trash2 className="h-4 w-4" />
          </span>
        )}
      </button>

      {isExpanded && (
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
                            <td className="px-3 py-1.5 text-right tabular-nums">{p.thicknessMm ?? "—"}</td>
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
                          {job.material ?? "Material"} — {g.thicknessMm} mm
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">{g.partCount} parts · {g.totalPcs} pcs</p>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Grouped by thickness. Standard Calculations does not yet track material per part, so material shown here reflects the job — thickness is what drives compatibility today.
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
                            Available: {s.availableQty} sheets
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
                        <span className="font-medium text-foreground">{job.material ?? "Material"} / {c.thicknessMm} mm</span>
                        <span className="text-muted-foreground">Required: {c.totalPcs} pcs</span>
                        {c.covered ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" /> Covered</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-medium text-destructive"><AlertTriangle className="h-3.5 w-3.5" /> Missing source material</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* RUN NESTING */}
              <div className="flex items-center justify-between bg-muted/10 px-4 py-3">
                <p className="text-xs text-muted-foreground">
                  Nesting optimization (placement, rotation, scrap) is not implemented yet — this stage only prepares parts and source inputs for that future engine.
                </p>
                <Button
                  disabled={!allCovered}
                  title={allCovered ? "Inputs are ready for the future nesting engine" : "All groups need compatible source material first"}
                  onClick={() => toast.info("Nesting engine is coming in a later phase — inputs for this job are ready.")}
                >
                  <Play className="h-4 w-4" /> Run Nesting
                </Button>
              </div>
            </>
          )}
        </div>
      )}

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
    if (!(qty > 0)) { toast.error("Available quantity must be at least 1"); return; }

    setSubmitting(true);
    const res = await fetch(`/api/nesting/jobs/${jobId}/sources`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: material.trim(), thicknessMm: thickness, widthMm: width, lengthMm: length, availableQty: qty }),
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
              <Label>Available Qty</Label>
              <Input type="number" step="1" value={availableQty} onChange={(e) => setAvailableQty(e.target.value)} />
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
