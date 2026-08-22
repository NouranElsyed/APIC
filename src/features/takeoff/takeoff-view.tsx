"use client";
import * as React from "react";
import { Plus, Trash2, Ruler, FolderKanban, Layers, Filter, X } from "lucide-react";
<<<<<<< HEAD
=======
import Link from "next/link";
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/empty-state";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DrawingForm } from "./drawing-form";
import { PartsGrid } from "./parts-grid";
<<<<<<< HEAD
import { useTakeoffProject } from "./project-context";
import type { TakeoffDrawingRow, TakeoffPartRow, PartType, PartSide } from "./types";
=======
import type { TakeoffDrawingRow, TakeoffPartRow, ProjectOption, PartType, PartSide } from "./types";
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
import { toast } from "sonner";

function fmt(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const PART_TYPE_LABEL: Record<PartType, string> = {
  PLATE: "Plate",
  HOT_ROLLED: "Hot Rolled",
  CONE: "Cone",
  PIPE: "Pipe",
};

interface Filters {
  type: PartType | "ALL";
  thickness: string; // exact-match text, blank = any
  description: string; // substring search, case-insensitive
  side: PartSide | "ALL";
}

const emptyFilters: Filters = { type: "ALL", thickness: "", description: "", side: "ALL" };

function matchesFilters(part: TakeoffPartRow, f: Filters): boolean {
  if (f.type !== "ALL" && part.partType !== f.type) return false;
  if (f.side !== "ALL" && part.side !== f.side) return false;
  if (f.thickness.trim() !== "") {
    const wanted = Number(f.thickness);
    if (!Number.isFinite(wanted) || part.thicknessMm !== wanted) return false;
  }
  if (f.description.trim() !== "") {
    if (!part.description.toLowerCase().includes(f.description.trim().toLowerCase())) return false;
  }
  return true;
}

export function TakeoffView({ canCreate, canDelete }: { canCreate: boolean; canDelete: boolean }) {
<<<<<<< HEAD
  const { projects, projectId } = useTakeoffProject();
=======
  const [projects, setProjects] = React.useState<ProjectOption[]>([]);
  const [projectId, setProjectId] = React.useState<string>("");
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
  const [drawings, setDrawings] = React.useState<TakeoffDrawingRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [filters, setFilters] = React.useState<Filters>(emptyFilters);

  const [drawingFormOpen, setDrawingFormOpen] = React.useState(false);
  const [deletingDrawing, setDeletingDrawing] = React.useState<TakeoffDrawingRow | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

<<<<<<< HEAD
=======
  React.useEffect(() => {
    fetch("/api/projects").then((r) => r.json()).then((data) => {
      setProjects(data);
      if (data.length > 0) setProjectId((prev) => prev || data[0].id);
    });
  }, []);

>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
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

  const filtersActive = filters.type !== "ALL" || filters.side !== "ALL" || filters.thickness.trim() !== "" || filters.description.trim() !== "";

  // Filtered view of every drawing — filters apply across the whole
  // project, not just one drawing, so grand totals below always reflect
  // exactly what's visible on screen.
  const filteredDrawings = React.useMemo(() => {
    if (!filtersActive) return drawings;
    return drawings.map((d) => ({ ...d, parts: d.parts.filter((p) => matchesFilters(p, filters)) }));
  }, [drawings, filters, filtersActive]);

  const allVisibleParts = React.useMemo(
    () => filteredDrawings.flatMap((d) => d.parts),
    [filteredDrawings],
  );

  const grandTotalWeight = allVisibleParts.reduce((s, p) => s + num(p.weightKg), 0);
  const grandTotalArea = allVisibleParts.reduce((s, p) => s + num(p.totalArea), 0);
  const grandExternalWeight = allVisibleParts.filter((p) => p.side === "EXTERNAL").reduce((s, p) => s + num(p.weightKg), 0);
  const grandInternalWeight = allVisibleParts.filter((p) => p.side === "INTERNAL").reduce((s, p) => s + num(p.weightKg), 0);

  return (
    <div className="space-y-6">
<<<<<<< HEAD
      {projectId && canCreate && (
        <div className="flex justify-end">
          <Button onClick={() => setDrawingFormOpen(true)}>
            <Plus className="h-4 w-4" /> Add Drawing
          </Button>
        </div>
      )}
=======
      <div className="flex gap-2 border-b border-border">
        <div className="border-b-2 border-primary px-1 pb-2 text-sm font-semibold text-foreground">Standard Calculations</div>
        <Link href="/takeoff/nesting" className="px-1 pb-2 text-sm font-medium text-muted-foreground transition hover:text-foreground">
          DXF Nesting
        </Link>
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
          <Button onClick={() => setDrawingFormOpen(true)} disabled={!projectId}>
            <Plus className="h-4 w-4" /> Add Drawing
          </Button>
        )}
      </div>
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844

      {projectId && drawings.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex items-center gap-1.5 pb-2 text-xs font-medium text-muted-foreground">
              <Filter className="h-3.5 w-3.5" /> Filter (all drawings)
            </div>
            <div className="w-36 space-y-1">
              <label className="block text-xs text-muted-foreground">Type</label>
              <Select value={filters.type} onValueChange={(v) => setFilters((f) => ({ ...f, type: v as Filters["type"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All types</SelectItem>
                  {(Object.keys(PART_TYPE_LABEL) as PartType[]).map((pt) => (
                    <SelectItem key={pt} value={pt}>{PART_TYPE_LABEL[pt]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-28 space-y-1">
              <label className="block text-xs text-muted-foreground">Thk (mm)</label>
              <Input type="number" step="any" placeholder="Any" value={filters.thickness} onChange={(e) => setFilters((f) => ({ ...f, thickness: e.target.value }))} />
            </div>
            <div className="w-56 space-y-1">
              <label className="block text-xs text-muted-foreground">Description</label>
              <Input placeholder="Search description…" value={filters.description} onChange={(e) => setFilters((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="w-36 space-y-1">
              <label className="block text-xs text-muted-foreground">Side</label>
              <Select value={filters.side} onValueChange={(v) => setFilters((f) => ({ ...f, side: v as Filters["side"] }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Both sides</SelectItem>
                  <SelectItem value="EXTERNAL">External</SelectItem>
                  <SelectItem value="INTERNAL">Internal</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {filtersActive && (
              <Button size="sm" variant="ghost" onClick={() => setFilters(emptyFilters)}>
                <X className="h-3.5 w-3.5" /> Clear
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-1 border-t border-border pt-3 text-sm">
            <span>Total Weight: <span className="font-semibold text-primary">{fmt(grandTotalWeight, 1)} kg</span></span>
            <span>Total Area: <span className="font-semibold text-foreground">{fmt(grandTotalArea, 3)} m²</span></span>
            <span>Total External: <span className="font-semibold text-foreground">{fmt(grandExternalWeight, 1)} kg</span></span>
            <span>Total Internal: <span className="font-semibold text-foreground">{fmt(grandInternalWeight, 1)} kg</span></span>
          </div>
        </div>
      )}

      {!projectId ? (
        <EmptyState icon={<FolderKanban className="h-5 w-5" />} title="No project selected" description="Choose a project above to see its material take-off data." />
      ) : loading ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : drawings.length === 0 ? (
        <EmptyState
          icon={<Ruler className="h-5 w-5" />}
          title="No drawings yet"
          description={`Add the first fabrication drawing for ${selectedProject?.number ?? "this project"} to start entering parts.`}
          action={canCreate ? <Button onClick={() => setDrawingFormOpen(true)}><Plus className="h-4 w-4" /> Add Drawing</Button> : undefined}
        />
      ) : (
        <div className="space-y-6">
          {filteredDrawings.map((drawing) => {
            if (filtersActive && drawing.parts.length === 0) return null;
            const totalArea = drawing.parts.reduce((s, p) => s + num(p.totalArea), 0);
            const totalWeight = drawing.parts.reduce((s, p) => s + num(p.weightKg), 0);
            const totalPaintArea = drawing.parts.reduce((s, p) => s + num(p.paintAreaSqm), 0);
            const scrapRows = drawing.parts.filter((p) => typeof p.scrapKg === "number");
            const totalScrap = scrapRows.length > 0 ? scrapRows.reduce((s, p) => s + num(p.scrapKg), 0) : null;
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
                        {totalScrap !== null && (
                          <>
                            {"  ·  "}Scrap: <span className="font-medium text-amber-600">{fmt(totalScrap, 1)} kg</span>
                          </>
                        )}
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
                  projectId={projectId}
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
