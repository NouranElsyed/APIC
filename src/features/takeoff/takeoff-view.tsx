"use client";
import * as React from "react";
import { Plus, Trash2, Ruler, FolderKanban, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DrawingForm } from "./drawing-form";
import { PartsGrid } from "./parts-grid";
import type { TakeoffDrawingRow, ProjectOption } from "./types";
import { toast } from "sonner";

function fmt(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function TakeoffView({ canCreate, canDelete }: { canCreate: boolean; canDelete: boolean }) {
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = React.useState<string>("");
  const [drawings, setDrawings] = React.useState<TakeoffDrawingRow[]>([]);
  const [loading, setLoading] = React.useState(false);

  const [drawingFormOpen, setDrawingFormOpen] = React.useState(false);
  const [deletingDrawing, setDeletingDrawing] = React.useState<TakeoffDrawingRow | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((data) => {
      setProjects(data);
      if (data.length > 0) setProjectId((prev) => prev || data[0].id);
    });
  }, []);

  const loadDrawings = React.useCallback(async (pid: string) => {
    if (!pid) return;
    setLoading(true);
    const res = await fetch(`/api/takeoff/drawings?projectId=${pid}`);
    setDrawings(res.ok ? await res.json() : []);
    setLoading(false);
  }, []);

  React.useEffect(() => { loadDrawings(projectId); }, [projectId, loadDrawings]);

  const selectedProject = projects.find((p) => p.id === projectId);

  async function handleDeleteDrawing() {
    if (!deletingDrawing) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/takeoff/drawings/${deletingDrawing.id}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) { toast.error("Failed to delete drawing"); return; }
    toast.success("Drawing deleted");
    setDeletingDrawing(null);
    loadDrawings(projectId);
  }

  return (
    <div className="space-y-6">
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
          <Button onClick={() => setDrawingFormOpen(true)} disabled={!projectId}>
            <Plus className="h-4 w-4" /> Add Drawing
          </Button>
        )}
      </div>

      {!projectId ? (
        <EmptyState icon={FolderKanban} title="No project selected" description="Choose a project above to see its material take-off data." />
      ) : loading ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : drawings.length === 0 ? (
        <EmptyState
          icon={Ruler}
          title="No drawings yet"
          description={`Add the first fabrication drawing for ${selectedProject?.number ?? "this project"} to start entering parts.`}
          action={canCreate ? <Button onClick={() => setDrawingFormOpen(true)}><Plus className="h-4 w-4" /> Add Drawing</Button> : undefined}
        />
      ) : (
        <div className="space-y-6">
          {drawings.map((drawing) => {
            const totalArea = drawing.parts.reduce((s, p) => s + num(p.totalArea), 0);
            const totalWeight = drawing.parts.reduce((s, p) => s + num(p.weightKg), 0);
            const totalPaintArea = drawing.parts.reduce((s, p) => s + num(p.paintAreaSqm), 0);
            const variance = drawing.weightFromDwg != null ? totalWeight - drawing.weightFromDwg : null;

            return (
              <div key={drawing.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-semibold text-foreground">{drawing.drawingNumber} — {drawing.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Total Area: <span className="font-medium text-foreground">{fmt(totalArea, 3)} m²</span>
                        {"  ·  "}Paint Area: <span className="font-medium text-foreground">{fmt(totalPaintArea, 3)} m²</span>
                        {"  ·  "}Total Weight: <span className="font-medium text-foreground">{fmt(totalWeight, 1)} kg</span>
                        {variance !== null && (
                          <>
                            {"  ·  "}vs. Drawing: <span className={variance === 0 ? "text-foreground" : variance > 0 ? "text-destructive" : "text-emerald-600"}>
                              {variance > 0 ? "+" : ""}{fmt(variance, 1)} kg
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                  {canDelete && (
                    <Button size="icon" variant="ghost" onClick={() => setDeletingDrawing(drawing)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>

                <PartsGrid
                  drawingId={drawing.id}
                  parts={drawing.parts}
                  canCreate={canCreate}
                  canDelete={canDelete}
                  onChanged={() => loadDrawings(projectId)}
                />
              </div>
            );
          })}
        </div>
      )}

      {projectId && (
        <DrawingForm
          open={drawingFormOpen}
          onOpenChange={setDrawingFormOpen}
          projectId={projectId}
          onSaved={() => loadDrawings(projectId)}
        />
      )}

      <ConfirmDialog
        open={!!deletingDrawing}
        onOpenChange={(v) => !v && setDeletingDrawing(null)}
        title="Delete drawing?"
        description={`This will remove "${deletingDrawing?.drawingNumber}" and all its parts. This cannot be undone.`}
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={handleDeleteDrawing}
      />
    </div>
  );
}
