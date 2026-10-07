"use client";
import * as React from "react";
import { Loader2, Check, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useTakeoffProject } from "./project-context";
import type { TakeoffDrawingRow } from "./types";
import { nestPartDescription, nestPartFileName, nestPartToDxf, parseNestParts, type NestPart } from "./nest-parts";

const NEW_DRAWING = "__new__";
const selectCls =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

type Status = "idle" | "importing" | "done" | "error";
interface Row extends NestPart {
  checked: boolean;
  /** Thickness as typed (can be changed here before the plate is created). */
  thk: string;
  status: Status;
  error?: string;
}

/** Small picture of the part (outline with its holes cut out). */
function Thumb({ p }: { p: NestPart }) {
  const minX = Math.min(...p.outer.map((q) => q[0]));
  const minY = Math.min(...p.outer.map((q) => q[1]));
  const d = [p.outer, ...p.holes]
    .map((l) => "M" + l.map((q) => `${(q[0] - minX).toFixed(1)} ${(p.h - (q[1] - minY)).toFixed(1)}`).join("L") + "Z")
    .join("");
  const pad = Math.max(p.w, p.h) * 0.04;
  return (
    <svg viewBox={`${-pad} ${-pad} ${p.w + 2 * pad} ${p.h + 2 * pad}`} className="h-8 w-12" aria-hidden="true">
      <path d={d} fillRule="evenodd" className="fill-primary/30 stroke-primary" strokeWidth={Math.max(p.w, p.h) / 60} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * "Take parts from DXF Nesting": the parts of a nest (this project's saved nest, or one of the user's history entries)
 * become plates of a drawing in Standard Calculations. Each plate keeps its exact shape — a one-part DXF is built from
 * the nest part and goes through the same importer as an uploaded DXF, so area, cut-outs and download all work.
 */
export function NestingImportDialog({
  open, onOpenChange, projectId, drawings, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  drawings: TakeoffDrawingRow[];
  onImported: () => void;
}) {
  const { history, refreshHistory } = useTakeoffProject();
  const [source, setSource] = React.useState("project"); // "project" | "h:<historyId>"
  const [loaded, setLoaded] = React.useState<{ key: string; rows: Row[] } | null>(null);
  const [target, setTarget] = React.useState<string | null>(null); // null = not touched: use the default
  const [newNo, setNewNo] = React.useState("NESTING");
  const [newTitle, setNewTitle] = React.useState("Parts from DXF Nesting");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) void refreshHistory();
  }, [open, refreshHistory]);

  // load the chosen nest; `loaded.key` tells which nest the rows belong to (so a stale answer is never shown)
  const key = `${projectId}|${source}`;
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const q = source === "project" ? `projectId=${projectId}` : `historyId=${source.slice(2)}`;
    fetch(`/api/nesting/workspace?kind=2D&${q}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((j: { data?: unknown } | null) => {
        if (cancelled) return;
        const rows = parseNestParts(j?.data).map((p): Row => ({ ...p, checked: true, thk: p.th ? String(p.th) : "", status: "idle" }));
        setLoaded({ key, rows });
      });
    return () => {
      cancelled = true;
    };
  }, [open, key, source, projectId]);

  const loading = open && loaded?.key !== key;
  const rows = React.useMemo(() => (loaded?.key === key ? loaded.rows : []), [loaded, key]);
  const patch = (id: number, u: Partial<Row>) =>
    setLoaded((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...u } : r)) } : prev));

  const defaultTarget = drawings.find((d) => d.drawingNumber === "NESTING")?.id ?? NEW_DRAWING;
  const chosen = target ?? defaultTarget;
  const targetDrawing = drawings.find((d) => d.id === chosen);

  // a part already taken into this drawing (same name and thickness) is not offered twice
  const taken = new Set((targetDrawing?.parts ?? []).map((p) => `${p.description.trim().toLowerCase()}|${p.thicknessMm ?? 0}`));
  const isTaken = (r: Row) => taken.has(`${nestPartDescription(r).toLowerCase()}|${Number(r.thk) || 0}`);
  const pick = rows.filter((r) => r.checked && r.status !== "done" && !isTaken(r));
  const noThk = pick.filter((r) => !(Number(r.thk) > 0)).length;
  const selectable = rows.filter((r) => r.status !== "done" && !isTaken(r));
  const allOn = selectable.length > 0 && selectable.every((r) => r.checked);
  const newInvalid = chosen === NEW_DRAWING && (!newNo.trim() || !newTitle.trim());

  async function run() {
    setBusy(true);
    let drawingId = chosen;
    if (chosen === NEW_DRAWING) {
      const res = await fetch("/api/takeoff/drawings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, drawingNumber: newNo.trim(), title: newTitle.trim(), weightFromDwg: null }),
      }).catch(() => null);
      if (!res?.ok) {
        setBusy(false);
        toast.error("Could not create the drawing");
        return;
      }
      drawingId = ((await res.json()) as { id: string }).id;
      setTarget(drawingId);
    }
    let ok = 0;
    let failed = 0;
    for (const r of pick) {
      patch(r.id, { status: "importing", error: undefined });
      const form = new FormData();
      form.append("file", new File([nestPartToDxf(r)], nestPartFileName(r), { type: "application/dxf" }));
      form.append(
        "items",
        JSON.stringify([
          {
            partIndex: 0,
            description: nestPartDescription(r),
            side: "EXTERNAL",
            qty: r.qty,
            thicknessMm: Number(r.thk) > 0 ? Number(r.thk) : null,
            paintSides: 2,
            material: r.material || "Steel",
          },
        ]),
      );
      const res = await fetch(`/api/takeoff/drawings/${drawingId}/import`, { method: "POST", body: form }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { results?: { ok: boolean; error?: string }[]; error?: string } | null;
      const hit = body?.results?.[0];
      if (res?.ok && hit?.ok) {
        ok++;
        patch(r.id, { status: "done" });
      } else {
        failed++;
        patch(r.id, { status: "error", error: hit?.error ?? body?.error ?? "Import failed" });
      }
    }
    setBusy(false);
    if (ok) {
      toast.success(`${ok} part(s) taken from DXF Nesting`);
      onImported();
    }
    if (failed) toast.error(`${failed} part(s) could not be added — see the list`);
    else if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-1rem)] overflow-y-auto p-4 sm:max-w-5xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Take parts from DXF Nesting</DialogTitle>
          <DialogDescription>
            The parts of a nest become plates of this project. Size, area and cut-outs come from the shape, and each plate keeps its own DXF.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-xs text-muted-foreground">
            From
            <select className={selectCls} value={source} disabled={busy} onChange={(e) => setSource(e.target.value)}>
              <option value="project">This project’s nest</option>
              {history.map((h) => (
                <option key={h.id} value={`h:${h.id}`}>
                  History — {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            Into drawing
            <select className={selectCls} value={chosen} disabled={busy} onChange={(e) => setTarget(e.target.value)}>
              {drawings.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.drawingNumber} — {d.title}
                </option>
              ))}
              <option value={NEW_DRAWING}>+ New drawing…</option>
            </select>
          </label>
          {chosen === NEW_DRAWING && (
            <>
              <label className="space-y-1 text-xs text-muted-foreground">
                Drawing number
                <Input value={newNo} disabled={busy} onChange={(e) => setNewNo(e.target.value)} />
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Title
                <Input value={newTitle} disabled={busy} onChange={(e) => setNewTitle(e.target.value)} />
              </label>
            </>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Reading the nest…
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
            {source === "project"
              ? "This project has no nest saved yet. Pick a history entry above, or add parts in the DXF Nesting tab first."
              : "This history entry has no parts."}
          </div>
        ) : (
          <>
            {noThk > 0 && (
              <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {noThk} selected part(s) have no thickness. They are added without one, so their weight stays 0 until you fill it in — type it here to avoid that.
              </p>
            )}
            <div className="max-h-[46vh] overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse text-xs">
                <thead className="sticky top-0 bg-card text-left text-muted-foreground shadow-[0_1px_0_0_var(--border,#e5e7eb)]">
                  <tr>
                    <th className="p-2">
                      <Checkbox
                        aria-label="Select all"
                        checked={allOn}
                        disabled={busy || selectable.length === 0}
                        onCheckedChange={(v) => setLoaded((prev) => (prev ? { ...prev, rows: prev.rows.map((r) => (r.status === "done" || isTaken(r) ? r : { ...r, checked: v === true })) } : prev))}
                      />
                    </th>
                    <th className="p-2" />
                    <th className="p-2">Part</th>
                    <th className="p-2">Size (mm)</th>
                    <th className="hidden p-2 sm:table-cell">Area (m²)</th>
                    <th className="hidden p-2 sm:table-cell">Holes</th>
                    <th className="p-2">Thick (mm)</th>
                    <th className="hidden p-2 md:table-cell">Material</th>
                    <th className="p-2">Qty</th>
                    <th className="p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dup = isTaken(r) && r.status !== "done";
                    return (
                      <tr key={r.id} className={`border-t border-border ${dup ? "opacity-60" : ""}`}>
                        <td className="p-2">
                          <Checkbox
                            aria-label={`Select ${r.name}`}
                            checked={r.checked && !dup && r.status !== "done"}
                            disabled={busy || dup || r.status === "done"}
                            onCheckedChange={(v) => patch(r.id, { checked: v === true })}
                          />
                        </td>
                        <td className="p-1"><Thumb p={r} /></td>
                        <td className="max-w-48 break-all p-2">{nestPartDescription(r)}</td>
                        <td className="whitespace-nowrap p-2">{r.w.toFixed(1)} × {r.h.toFixed(1)}</td>
                        <td className="hidden p-2 sm:table-cell">{(r.area / 1e6).toFixed(3)}</td>
                        <td className="hidden p-2 sm:table-cell">{r.holes.length}</td>
                        <td className="p-1">
                          <Input
                            type="number" min={0} step="any" placeholder="?" aria-label={`Thickness of ${r.name}`}
                            className={`h-8 w-20 ${!(Number(r.thk) > 0) ? "border-amber-400" : ""}`}
                            value={r.thk} disabled={busy || r.status === "done"}
                            onChange={(e) => patch(r.id, { thk: e.target.value })}
                          />
                        </td>
                        <td className="hidden p-2 md:table-cell">{r.material || "—"}</td>
                        <td className="p-2 font-semibold tabular-nums">{r.qty}</td>
                        <td className="p-2 whitespace-nowrap">
                          {r.status === "importing" ? (
                            <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Adding…</span>
                          ) : r.status === "done" ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800"><Check className="h-3 w-3" /> Added</span>
                          ) : r.status === "error" ? (
                            <span className="text-destructive" title={r.error}>{r.error ?? "Failed"}</span>
                          ) : dup ? (
                            <span className="text-muted-foreground" title="A plate with this name and thickness is already in the chosen drawing">Already in drawing</span>
                          ) : (
                            <span className="text-muted-foreground">Ready</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {rows.some((r) => r.status === "done") ? "Close" : "Cancel"}
          </Button>
          <Button disabled={busy || loading || pick.length === 0 || newInvalid} onClick={() => void run()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Add {pick.length > 0 ? `${pick.length} part(s)` : "parts"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
