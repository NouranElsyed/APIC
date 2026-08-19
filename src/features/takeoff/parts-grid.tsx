"use client";
import * as React from "react";
import { Pencil, Trash2, Plus, Sigma, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { toast } from "sonner";
import { explainTakeoffPart } from "@/server/calc/takeoff";
import { PartForm } from "./part-form";
import type { TakeoffPartRow, PartType } from "./types";

// Defensive: legacy/partial rows can come back from the API as null —
// never let that turn a running total into NaN.
function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const PART_TYPE_LABEL: Record<PartType, string> = {
  PLATE: "Plate",
  HOT_ROLLED: "Hot Rolled",
  CONE: "Cone",
  PIPE: "Pipe",
};

function geometrySummary(part: TakeoffPartRow): string {
  const g = (part.geometry ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
  switch (part.partType) {
    case "PLATE":
      return `${num(g.width) || "—"} × ${num(g.length) || "—"} m${g.cutoffFormula ? ", cut-out" : ""}`;
    case "CONE":
      return `D1 ${num(g.d1) || "—"} / D2 ${num(g.d2) || "—"} / H ${num(g.height) || "—"} m`;
    case "PIPE":
      return `OD ${num(g.od) || "—"} m × L ${num(g.length) || "—"} m`;
    case "HOT_ROLLED":
      return `${String(g.profile ?? "—")}, L ${num(g.length) || "—"} m`;
    default:
      return "—";
  }
}

export function PartsGrid({
  drawingId, parts, canCreate, canDelete, onChanged,
}: {
  drawingId: string;
  parts: TakeoffPartRow[];
  canCreate: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TakeoffPartRow | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);

  const nextItemNo = parts.reduce((max, p) => Math.max(max, p.itemNo), 0) + 1;

  function openAdd() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(part: TakeoffPartRow) {
    setEditing(part);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deletingId) return;
    setDeleteLoading(true);
    const res = await fetch(`/api/takeoff/parts/${deletingId}`, { method: "DELETE" });
    setDeleteLoading(false);
    if (!res.ok) { toast.error("Failed to delete item"); return; }
    toast.success("Item deleted");
    setDeletingId(null);
    onChanged();
  }

  const totalArea = parts.reduce((s, p) => s + n(p.totalArea), 0);
  const totalPaintArea = parts.reduce((s, p) => s + n(p.paintAreaSqm), 0);
  const totalWeight = parts.reduce((s, p) => s + n(p.weightKg), 0);
  const scrapRows = parts.filter((p) => typeof p.scrapKg === "number");
  const totalScrap = scrapRows.length > 0 ? scrapRows.reduce((s, p) => s + n(p.scrapKg), 0) : null;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
              <th className="px-2 py-1.5 font-medium">Item</th>
              <th className="px-2 py-1.5 font-medium">Description</th>
              <th className="border-l border-border px-2 py-1.5 font-medium">Type</th>
              <th className="px-2 py-1.5 font-medium">Geometry</th>
              <th className="border-l border-border px-2 py-1.5 font-medium">Side</th>
              <th className="px-2 py-1.5 text-right font-medium">Qty</th>
              <th className="px-2 py-1.5 text-right font-medium">Thk (mm)</th>
              <th className="px-2 py-1.5 text-center font-medium">Paint</th>
              <th className="border-l border-border px-2 py-1.5 text-right font-medium">Total Area</th>
              <th className="px-2 py-1.5 text-right font-medium">Paint Area</th>
              <th className="px-2 py-1.5 text-right font-medium">Weight (kg)</th>
              <th className="border-l border-border px-2 py-1.5 text-right font-medium">Buy (kg)</th>
              <th className="px-2 py-1.5 text-right font-medium">Scrap</th>
              <th className="px-1 py-1.5" />
              <th className="px-1 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 && (
              <tr>
                <td colSpan={15} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No items yet — use &quot;Add Item&quot; to enter the first part.
                </td>
              </tr>
            )}
            {parts.map((part) => {
              const isExpanded = expandedId === part.id;
              const explanation = isExpanded
                ? explainTakeoffPart({
                    partType: part.partType,
                    geometry: part.geometry,
                    qty: part.qty,
                    thicknessMm: part.thicknessMm,
                    paintSides: part.paintSides,
                    areaFormula: part.areaFormula,
                    buyWeightKg: part.buyWeightKg,
                  })
                : null;
              return (
                <React.Fragment key={part.id}>
                  <tr className="border-b border-border hover:bg-muted/10">
                    <td className="px-2 py-1.5 tabular-nums">{part.itemNo}</td>
                    <td className="px-2 py-1.5">{part.description}</td>
                    <td className="border-l border-border px-2 py-1.5">{PART_TYPE_LABEL[part.partType]}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">{geometrySummary(part)}</td>
                    <td className="border-l border-border px-2 py-1.5 text-xs">{part.side === "INTERNAL" ? "Internal" : "External"}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{part.qty}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{part.thicknessMm ?? "—"}</td>
                    <td className="px-2 py-1.5 text-center text-xs">{part.paintSides === 1 ? "1 side" : "2 sides"}</td>
                    <td className="border-l border-border px-2 py-1.5 text-right tabular-nums">{n(part.totalArea).toFixed(3)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{n(part.paintAreaSqm).toFixed(3)}</td>
                    <td className="px-2 py-1.5 text-right font-medium tabular-nums text-primary">{n(part.weightKg).toFixed(1)}</td>
                    <td className="border-l border-border px-2 py-1.5 text-right tabular-nums">{part.buyWeightKg != null ? part.buyWeightKg.toFixed(1) : "—"}</td>
                    <td className={`px-2 py-1.5 text-right tabular-nums ${part.scrapKg != null ? (part.scrapKg < 0 ? "text-destructive" : "text-amber-600") : "text-muted-foreground/50"}`}>
                      {part.scrapKg != null
                        ? `${part.scrapKg.toFixed(1)}${part.scrapPct != null ? ` (${(part.scrapPct * 100).toFixed(0)}%)` : ""}`
                        : "—"}
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Show the equation for this row" onClick={() => setExpandedId(isExpanded ? null : part.id)}>
                        {isExpanded ? <X className="h-3.5 w-3.5 text-muted-foreground" /> : <Sigma className="h-3.5 w-3.5 text-muted-foreground" />}
                      </Button>
                    </td>
                    <td className="px-1 py-1.5">
                      <div className="flex items-center justify-end gap-1">
                        {canCreate && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(part)} title="Edit item">
                            <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDeletingId(part.id)} title="Delete item">
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isExpanded && explanation && (
                    <tr className="border-b border-border bg-primary/5">
                      <td colSpan={15} className="px-4 py-3">
                        <div className="flex flex-wrap gap-x-8 gap-y-1.5 text-xs">
                          {explanation.lines.map((line) => (
                            <div key={line.label} className="min-w-[180px]">
                              <div className="text-muted-foreground">{line.label}</div>
                              <div className="font-mono text-foreground">
                                {line.formula} <span className="text-muted-foreground">=</span> <span className="font-semibold">{line.result}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-3 py-2">
        {canCreate ? (
          <Button size="sm" variant="ghost" onClick={openAdd}>
            <Plus className="h-3.5 w-3.5" /> Add Item
          </Button>
        ) : <span />}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>Total Area: <span className="font-semibold text-foreground">{totalArea.toFixed(3)} m²</span></span>
          <span>Paint Area: <span className="font-semibold text-foreground">{totalPaintArea.toFixed(3)} m²</span></span>
          <span>Total Weight: <span className="font-semibold text-primary">{totalWeight.toFixed(1)} kg</span></span>
          {totalScrap !== null && (
            <span>Scrap: <span className="font-semibold text-amber-600">{totalScrap.toFixed(1)} kg</span></span>
          )}
        </div>
      </div>

      {canCreate && (
        <PartForm
          open={formOpen}
          onOpenChange={setFormOpen}
          drawingId={drawingId}
          editing={editing}
          nextItemNo={nextItemNo}
          onSaved={onChanged}
        />
      )}

      <ConfirmDialog
        open={!!deletingId}
        onOpenChange={(v) => !v && setDeletingId(null)}
        title="Delete item?"
        description="This will remove this part from the drawing. This cannot be undone."
        confirmLabel="Delete"
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </div>
  );
}
