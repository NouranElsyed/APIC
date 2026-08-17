"use client";
import * as React from "react";
import { Check, Trash2, Plus, Sigma, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { computeTakeoffPart, explainTakeoffPart } from "@/server/calc/takeoff";
import type { TakeoffPartRow } from "./types";

// A row is either an existing saved part (id starts with a real cuid) or a
// fresh blank buffer row (id starts with "new:"). Both are edited the same
// way; only the save action differs (PATCH vs POST).
interface GridRowState {
  id: string;
  isNew: boolean;
  itemNo: string;
  description: string;
  extWidth: string;
  extLength: string;
  intWidth: string;
  intLength: string;
  qty: string;
  thicknessMm: string;
  paintSides: "1" | "2";
  areaMode: "ADD" | "SUBTRACT";
}

let blankSeq = 0;
function blankRow(itemNo: number): GridRowState {
  blankSeq += 1;
  return {
    id: `new:${blankSeq}`,
    isNew: true,
    itemNo: String(itemNo),
    description: "",
    extWidth: "",
    extLength: "",
    intWidth: "",
    intLength: "",
    qty: "1",
    thicknessMm: "",
    paintSides: "2",
    areaMode: "ADD",
  };
}

function fromPart(part: TakeoffPartRow): GridRowState {
  return {
    id: part.id,
    isNew: false,
    itemNo: String(part.itemNo),
    description: part.description,
    extWidth: part.extWidth?.toString() ?? "",
    extLength: part.extLength?.toString() ?? "",
    intWidth: part.intWidth?.toString() ?? "",
    intLength: part.intLength?.toString() ?? "",
    qty: String(part.qty),
    thicknessMm: String(part.thicknessMm),
    paintSides: part.paintSides === 1 ? "1" : "2",
    areaMode: part.areaMode === "SUBTRACT" ? "SUBTRACT" : "ADD",
  };
}

function toCalcInput(row: GridRowState) {
  return {
    extWidth: row.extWidth ? Number(row.extWidth) : null,
    extLength: row.extLength ? Number(row.extLength) : null,
    intWidth: row.intWidth ? Number(row.intWidth) : null,
    intLength: row.intLength ? Number(row.intLength) : null,
    qty: Number(row.qty) || 0,
    thicknessMm: Number(row.thicknessMm) || 0,
    paintSides: Number(row.paintSides),
    areaMode: row.areaMode,
  };
}

function toComputed(row: GridRowState) {
  return computeTakeoffPart(toCalcInput(row));
}

function isRowUsable(row: GridRowState) {
  return row.description.trim() !== "" && Number(row.qty) > 0 && Number(row.thicknessMm) > 0;
}

function toPayload(row: GridRowState) {
  return {
    itemNo: Number(row.itemNo) || 0,
    description: row.description,
    extWidth: row.extWidth ? Number(row.extWidth) : null,
    extLength: row.extLength ? Number(row.extLength) : null,
    intWidth: row.intWidth ? Number(row.intWidth) : null,
    intLength: row.intLength ? Number(row.intLength) : null,
    qty: Number(row.qty) || 0,
    thicknessMm: Number(row.thicknessMm) || 0,
    paintSides: (Number(row.paintSides) === 1 ? 1 : 2) as 1 | 2,
    areaMode: row.areaMode,
  };
}

// Defensive: legacy rows saved before a field existed (e.g. before a
// migration backfilled it) can come back from the API as null — never let
// that turn a running total into NaN.
function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const BUFFER_ROWS = 3;
const cellInputClass =
  "h-8 w-full border-0 bg-transparent px-2 text-sm shadow-none focus-visible:ring-1 focus-visible:ring-primary";

export function PartsGrid({
  drawingId, parts, canCreate, canDelete, onChanged,
}: {
  drawingId: string;
  parts: TakeoffPartRow[];
  canCreate: boolean;
  canDelete: boolean;
  onChanged: () => void;
}) {
  const [savedRows, setSavedRows] = React.useState<GridRowState[]>(() => parts.map(fromPart));
  const [blanks, setBlanks] = React.useState<GridRowState[]>(() =>
    Array.from({ length: BUFFER_ROWS }, (_, i) => blankRow(parts.length + i + 1))
  );
  const [dirty, setDirty] = React.useState<Set<string>>(new Set());
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  // Re-sync from the server whenever the parent's parts list changes
  // (e.g. after a delete, or a save that came from this same component).
  React.useEffect(() => {
    setSavedRows(parts.map(fromPart));
    setDirty(new Set());
  }, [parts]);

  function updateSaved(id: string, field: keyof GridRowState, value: string) {
    setSavedRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
    setDirty((prev) => new Set(prev).add(id));
  }

  function updateBlank(id: string, field: keyof GridRowState, value: string) {
    setBlanks((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }

  async function saveExisting(row: GridRowState) {
    if (!isRowUsable(row)) { toast.error("Description, qty and thickness are required"); return; }
    setSavingId(row.id);
    const res = await fetch(`/api/takeoff/parts/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drawingId, ...toPayload(row) }),
    });
    setSavingId(null);
    if (!res.ok) { toast.error("Failed to save row"); return; }
    setDirty((prev) => { const next = new Set(prev); next.delete(row.id); return next; });
    toast.success("Saved");
    onChanged();
  }

  async function saveNew(row: GridRowState) {
    if (!isRowUsable(row)) { toast.error("Description, qty and thickness are required"); return; }
    setSavingId(row.id);
    const res = await fetch("/api/takeoff/parts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ drawingId, ...toPayload(row) }),
    });
    setSavingId(null);
    if (!res.ok) { toast.error("Failed to add row"); return; }
    // Replace this blank with a fresh one so the grid always has empty
    // rows ready — no "Add Part" click needed.
    setBlanks((prev) => {
      const rest = prev.filter((r) => r.id !== row.id);
      return [...rest, blankRow(savedRows.length + blanks.length + 1)];
    });
    toast.success("Part added");
    onChanged();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await fetch(`/api/takeoff/parts/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (!res.ok) { toast.error("Failed to delete part"); return; }
    toast.success("Part deleted");
    onChanged();
  }

  function removeBlank(id: string) {
    setBlanks((prev) => {
      const rest = prev.filter((r) => r.id !== id);
      // keep at least BUFFER_ROWS blanks available
      return rest.length >= BUFFER_ROWS ? rest : [...rest, blankRow(savedRows.length + rest.length + 1)];
    });
  }

  function addBlankRow() {
    setBlanks((prev) => [...prev, blankRow(savedRows.length + prev.length + 1)]);
  }

  const allRows: { row: GridRowState; kind: "saved" | "blank" }[] = [
    ...savedRows.map((row) => ({ row, kind: "saved" as const })),
    ...blanks.map((row) => ({ row, kind: "blank" as const })),
  ];

  const usableSaved = savedRows.filter(isRowUsable);
  const totalArea = usableSaved.reduce((s, r) => s + n(toComputed(r).totalArea), 0);
  const totalWeight = usableSaved.reduce((s, r) => s + n(toComputed(r).weightKg), 0);
  const totalPaintArea = usableSaved.reduce((s, r) => s + n(toComputed(r).paintAreaSqm), 0);

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-14 border-b border-border px-2 py-2 text-left">Item</th>
              <th className="min-w-[160px] border-b border-border px-2 py-2 text-left">Description</th>
              <th className="w-20 border-b border-l border-border px-2 py-2 text-right">Ext W</th>
              <th className="w-20 border-b border-border px-2 py-2 text-right">Ext L</th>
              <th className="w-20 border-b border-l border-border px-2 py-2 text-right">Int W</th>
              <th className="w-20 border-b border-border px-2 py-2 text-right">Int L</th>
              <th className="w-28 border-b border-l border-border px-2 py-2 text-center">Area Mode</th>
              <th className="w-14 border-b border-l border-border px-2 py-2 text-right">Qty</th>
              <th className="w-16 border-b border-border px-2 py-2 text-right">Thk</th>
              <th className="w-24 border-b border-l border-border px-2 py-2 text-center">Paint Sides</th>
              <th className="w-24 border-b border-l border-border px-2 py-2 text-right">T. Area (m²)</th>
              <th className="w-24 border-b border-border px-2 py-2 text-right">Paint Area (m²)</th>
              <th className="w-24 border-b border-border px-2 py-2 text-right">Weight (kg)</th>
              <th className="w-9 border-b border-border" />
              {(canCreate || canDelete) && <th className="w-16 border-b border-border" />}
            </tr>
          </thead>
          <tbody>
            {allRows.map(({ row, kind }) => {
              const computed = toComputed(row);
              const usable = isRowUsable(row);
              const isDirty = kind === "saved" && dirty.has(row.id);
              const showSave = kind === "blank" ? usable : isDirty;
              const onField = kind === "saved" ? updateSaved : updateBlank;
              const isBusy = savingId === row.id || deletingId === row.id;
              const isExpanded = expandedId === row.id;
              const explanation = isExpanded ? explainTakeoffPart(toCalcInput(row)) : null;

              return (
                <React.Fragment key={row.id}>
                  <tr className={`border-b border-border last:border-b-0 hover:bg-muted/30 ${kind === "blank" ? "bg-muted/10" : ""} ${isExpanded ? "bg-primary/5" : ""}`}>
                    <td className="px-1 py-0.5">
                      <Input className={cellInputClass} value={row.itemNo} disabled={!canCreate} onChange={(e) => onField(row.id, "itemNo", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={cellInputClass} value={row.description} placeholder={kind === "blank" ? "PL 20 mm" : undefined} disabled={!canCreate} onChange={(e) => onField(row.id, "description", e.target.value)} />
                    </td>
                    <td className="border-l border-border px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.extWidth} disabled={!canCreate} onChange={(e) => onField(row.id, "extWidth", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.extLength} disabled={!canCreate} onChange={(e) => onField(row.id, "extLength", e.target.value)} />
                    </td>
                    <td className="border-l border-border px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.intWidth} disabled={!canCreate} onChange={(e) => onField(row.id, "intWidth", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.intLength} disabled={!canCreate} onChange={(e) => onField(row.id, "intLength", e.target.value)} />
                    </td>
                    <td className="border-l border-border px-1 py-0.5 text-center">
                      <select
                        className="h-8 w-full rounded-md border-0 bg-transparent px-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        value={row.areaMode}
                        disabled={!canCreate}
                        title="Add: ext + int (e.g. duct inner+outer walls). Subtract: ext − int (e.g. plate with a hole)."
                        onChange={(e) => onField(row.id, "areaMode", e.target.value)}
                      >
                        <option value="ADD">Ext + Int</option>
                        <option value="SUBTRACT">Ext − Int</option>
                      </select>
                    </td>
                    <td className="border-l border-border px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" value={row.qty} disabled={!canCreate} onChange={(e) => onField(row.id, "qty", e.target.value)} />
                    </td>
                    <td className="px-1 py-0.5">
                      <Input className={`${cellInputClass} text-right`} type="number" step="any" value={row.thicknessMm} disabled={!canCreate} onChange={(e) => onField(row.id, "thicknessMm", e.target.value)} />
                    </td>
                    <td className="border-l border-border px-1 py-0.5 text-center">
                      <select
                        className="h-8 w-full rounded-md border-0 bg-transparent px-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                        value={row.paintSides}
                        disabled={!canCreate}
                        onChange={(e) => onField(row.id, "paintSides", e.target.value)}
                      >
                        <option value="1">1 side</option>
                        <option value="2">2 sides</option>
                      </select>
                    </td>
                    <td className={`border-l border-border px-2 py-0.5 text-right tabular-nums ${usable ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {usable ? computed.totalArea.toFixed(3) : "—"}
                    </td>
                    <td className={`px-2 py-0.5 text-right tabular-nums ${usable ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {usable ? computed.paintAreaSqm.toFixed(3) : "—"}
                    </td>
                    <td className={`px-2 py-0.5 text-right font-medium tabular-nums ${usable ? "text-primary" : "text-muted-foreground/50"}`}>
                      {usable ? computed.weightKg.toFixed(1) : "—"}
                    </td>
                    <td className="px-1 py-0.5 text-center">
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7"
                        title="Show the equation for this row"
                        onClick={() => setExpandedId(isExpanded ? null : row.id)}
                      >
                        {isExpanded ? <X className="h-3.5 w-3.5 text-muted-foreground" /> : <Sigma className="h-3.5 w-3.5 text-muted-foreground" />}
                      </Button>
                    </td>
                    {(canCreate || canDelete) && (
                      <td className="px-1 py-0.5">
                        <div className="flex items-center justify-end gap-1">
                          {canCreate && showSave && (
                            <Button
                              size="icon" variant="ghost" className="h-7 w-7"
                              disabled={isBusy}
                              onClick={() => (kind === "saved" ? saveExisting(row) : saveNew(row))}
                              title="Save row"
                            >
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            </Button>
                          )}
                          {canDelete && kind === "saved" && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" disabled={isBusy} onClick={() => handleDelete(row.id)} title="Delete part">
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          )}
                          {canCreate && kind === "blank" && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeBlank(row.id)} title="Remove empty row">
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {isExpanded && explanation && (
                    <tr className="border-b border-border bg-primary/5">
                      <td colSpan={14} className="px-4 py-3">
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
          <Button size="sm" variant="ghost" onClick={addBlankRow}>
            <Plus className="h-3.5 w-3.5" /> Add Row
          </Button>
        ) : <span />}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>Total Area: <span className="font-semibold text-foreground">{totalArea.toFixed(3)} m²</span></span>
          <span>Paint Area: <span className="font-semibold text-foreground">{totalPaintArea.toFixed(3)} m²</span></span>
          <span>Total Weight: <span className="font-semibold text-primary">{totalWeight.toFixed(1)} kg</span></span>
        </div>
      </div>
    </div>
  );
}
