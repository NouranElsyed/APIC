"use client";
import * as React from "react";
import Link from "next/link";
import { Plus, FolderKanban, Boxes, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import type { NestingJobRow } from "./types";
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

  async function handleRemoveItem(jobId: string, itemId: string) {
    const res = await fetch(`/api/nesting/jobs/${jobId}/items/${itemId}`, { method: "DELETE" });
    if (!res.ok) { toast.error("Failed to remove part"); return; }
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
          description={`Attach DXF files to parts in Standard Calculations, then create the first nesting job for ${selectedProject?.number ?? "this project"}.`}
          action={canCreate ? <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New Nesting Job</Button> : undefined}
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => {
            const isExpanded = expandedId === job.id;
            const totalArea = job.items.reduce((s, it) => s + (it.takeoffPart.dxf?.areaSqm ?? 0) * (it.qtyOverride ?? it.takeoffPart.qty), 0);
            return (
              <div key={job.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3 text-left"
                  onClick={() => setExpandedId(isExpanded ? null : job.id)}
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
                        {job.material ?? "No material set"}
                        {job.thicknessMm ? ` · ${job.thicknessMm} mm` : ""}
                        {"  ·  "}Parts: <span className="font-medium text-foreground">{job.items.length}</span>
                        {"  ·  "}DXF Area: <span className="font-medium text-foreground">{fmt(totalArea, 3)} m²</span>
                      </p>
                    </div>
                  </div>
                  {canDelete && (
                    <span
                      role="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
                      onClick={(e) => { e.stopPropagation(); setDeletingJob(job); }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </span>
                  )}
                </button>

                {isExpanded && (
                  <div className="overflow-x-auto">
                    {job.items.length === 0 ? (
                      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                        No parts yet — go to Standard Calculations, upload a DXF on a part, then use &quot;Add to Nesting&quot;.
                      </div>
                    ) : (
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                            <th className="px-3 py-1.5 font-medium">Description</th>
                            <th className="px-3 py-1.5 font-medium">Drawing</th>
                            <th className="px-3 py-1.5 font-medium">Type</th>
                            <th className="px-3 py-1.5 text-right font-medium">Qty</th>
                            <th className="px-3 py-1.5 text-right font-medium">DXF Area (m²)</th>
                            <th className="px-3 py-1.5 text-right font-medium">Bbox (mm)</th>
                            <th className="px-2 py-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {job.items.map((it) => (
                            <tr key={it.id} className="border-b border-border">
                              <td className="px-3 py-1.5">{it.takeoffPart.description}</td>
                              <td className="px-3 py-1.5 text-xs text-muted-foreground">{it.takeoffPart.drawing.drawingNumber}</td>
                              <td className="px-3 py-1.5 text-xs">{it.takeoffPart.partType}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{it.qtyOverride ?? it.takeoffPart.qty}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{it.takeoffPart.dxf?.areaSqm?.toFixed(3) ?? "—"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-xs">
                                {it.takeoffPart.dxf?.bboxWidthMm && it.takeoffPart.dxf?.bboxHeightMm
                                  ? `${it.takeoffPart.dxf.bboxWidthMm.toFixed(0)} × ${it.takeoffPart.dxf.bboxHeightMm.toFixed(0)}`
                                  : "—"}
                              </td>
                              <td className="px-2 py-1.5 text-right">
                                {canDelete && (
                                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => handleRemoveItem(job.id, it.id)} title="Remove from job">
                                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div className="border-t border-border bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Results</span> — nesting/placement optimization is coming in a later phase. This job currently just tracks which parts (with validated DXF geometry) are queued for it.
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
        description={`This will remove "${deletingJob?.name}" and its part list. The parts themselves (and their DXF files) are not affected.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={handleDeleteJob}
      />
    </div>
  );
}
