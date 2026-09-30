"use client";
import * as React from "react";
import { FileUp, Loader2, X, CircleCheck, CircleAlert, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseDxf, extractDxfTexts } from "@/server/calc/dxf";
import { computeTakeoffPart } from "@/server/calc/takeoff";
import { buildPartFromDxf, guessFromFileName, importableParts, type ImportRowConfig } from "@/server/calc/dxf-import";
import { assignLabels, boxOf } from "@/server/calc/dxf-labels";

// A DXF is always a plate, so there is no "type" to pick here.
// One file can hold many parts (a sheet with "5mm" / "x6" labels written on
// it): every part becomes its own row.
interface Row {
  key: string;
  fileKey: string;
  file: File;
  partIndex: number;
  partsInFile: number;
  areaSqm: number;
  bboxW: number;
  bboxH: number;
  unitsWarning: string | null;
  description: string;
  side: "INTERNAL" | "EXTERNAL";
  paintSides: "1" | "2";
  qty: string;
  qtyAuto: boolean;
  thk: string;
  thkAuto: boolean; // read from the drawing / file name, so "set for all" leaves it alone
  material: string;
  status: "idle" | "importing" | "done" | "error";
  error?: string;
}

const toNum = (v: string): number | null => {
  const x = Number(v);
  return v.trim() !== "" && Number.isFinite(x) ? x : null;
};

function sizeOf(r: Row) {
  return { valid: true, areaSqm: r.areaSqm, bboxWidthMm: r.bboxW, bboxHeightMm: r.bboxH };
}

function toConfig(r: Row): ImportRowConfig {
  return {
    description: r.description,
    partType: "PLATE",
    side: r.side,
    qty: Number(r.qty),
    thicknessMm: toNum(r.thk),
    paintSides: r.paintSides === "1" ? 1 : 2,
    material: r.material,
  };
}

// Live result for a row: either the computed numbers or why it can't be imported.
function evaluate(r: Row) {
  const built = buildPartFromDxf(sizeOf(r), toConfig(r));
  if (!built.ok) return built;
  const i = built.input as Record<string, unknown>;
  const c = computeTakeoffPart({
    partType: "PLATE",
    geometry: i.geometry as Record<string, unknown>,
    qty: i.qty as number,
    thicknessMm: i.thicknessMm as number,
    paintSides: i.paintSides as number,
    areaFormula: null,
  });
  return { ok: true as const, weightKg: c.weightKg };
}

export function DxfImportDialog({
  open, onOpenChange, drawingId, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drawingId: string;
  onImported: () => void;
}) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [fileErrors, setFileErrors] = React.useState<{ name: string; error: string }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const counter = React.useRef(0);
  // "Set for all" bar
  const [all, setAll] = React.useState({ side: "EXTERNAL" as Row["side"], paint: "2" as Row["paintSides"], material: "Steel", thk: "" });

  React.useEffect(() => { if (!open) { setRows([]); setFileErrors([]); setBusy(false); } }, [open]);

  function patch(key: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  async function addFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => f.name.toLowerCase().endsWith(".dxf"));
    if (files.length === 0) { toast.error("Only .dxf files are accepted"); return; }

    const fresh: Row[] = [];
    const errs: { name: string; error: string }[] = [];
    for (const file of files) {
      const fileKey = `f${++counter.current}`;
      let text = "";
      try { text = await file.text(); } catch { errs.push({ name: file.name, error: "Could not read file" }); continue; }
      const parsed = parseDxf(text);
      const parts = importableParts(parsed);
      if (parts.length === 0) { errs.push({ name: file.name, error: parsed.errorMessage ?? "No closed geometry found" }); continue; }

      const fromName = guessFromFileName(file.name);
      const labels = assignLabels(parts.map(boxOf), extractDxfTexts(text));
      const base = file.name.replace(/\.dxf$/i, "");

      // Reading order: by thickness group, then top-to-bottom bands, then left-to-right.
      const boxes = parts.map(boxOf);
      const band = Math.max(1, Math.min(...boxes.map((b) => b.maxY - b.minY)));
      const order = parts.map((_, i) => i).sort((a, b) => {
        const ta = labels[a].thicknessMm ?? Infinity, tb = labels[b].thicknessMm ?? Infinity;
        if (ta !== tb) return ta - tb;
        const ra = Math.round(-(boxes[a].minY + boxes[a].maxY) / 2 / band), rb = Math.round(-(boxes[b].minY + boxes[b].maxY) / 2 / band);
        return ra - rb || boxes[a].minX - boxes[b].minX;
      });

      for (const i of order) {
        const p = parts[i];
        const l = labels[i];
        const single = parts.length === 1;
        const qty = l.qty ?? (single ? fromName.qty : undefined);
        const thk = l.thicknessMm ?? fromName.thicknessMm;
        fresh.push({
          key: `${fileKey}#${i}`,
          fileKey, file, partIndex: i, partsInFile: parts.length,
          areaSqm: p.areaSqm, bboxW: p.bboxWidthMm, bboxH: p.bboxHeightMm,
          unitsWarning: single ? parsed.unitsWarning : null,
          description: l.label ?? (single ? fromName.description : `${fromName.description || base} #${i + 1}`),
          side: all.side,
          paintSides: all.paint,
          qty: String(qty ?? 1),
          qtyAuto: qty !== undefined,
          thk: thk !== undefined ? String(thk) : all.thk,
          thkAuto: thk !== undefined,
          material: all.material,
          status: "idle",
        });
      }
    }
    setRows((prev) => [...prev, ...fresh]);
    setFileErrors((prev) => [...prev, ...errs]);
    if (fresh.length) {
      const multi = new Set(fresh.filter((r) => r.partsInFile > 1).map((r) => r.fileKey)).size;
      if (multi) toast.success(`${fresh.length} parts found (sheets split into parts)`);
    }
  }

  function applyAll(p: Partial<typeof all>) {
    const next = { ...all, ...p };
    setAll(next);
    setRows((prev) => prev.map((r) => {
      if (r.status === "done") return r;
      const u: Partial<Row> = {};
      if (p.side !== undefined) u.side = next.side;
      if (p.paint !== undefined) u.paintSides = next.paint;
      if (p.material !== undefined) u.material = next.material;
      if (p.thk !== undefined && !r.thkAuto) u.thk = next.thk; // never overwrite a thickness read from the drawing
      return { ...r, ...u };
    }));
  }

  const evals = rows.map((r) => (r.status === "done" ? null : evaluate(r)));
  const importable = rows.filter((r, i) => r.status !== "done" && evals[i]?.ok);
  const totalWeight = evals.reduce((s, e) => s + (e && e.ok ? e.weightKg : 0), 0);

  async function runImport() {
    setBusy(true);
    let ok = 0;
    let failed = 0;
    // One request per FILE (all its selected parts together).
    const byFile = new Map<string, Row[]>();
    for (const r of importable) byFile.set(r.fileKey, [...(byFile.get(r.fileKey) ?? []), r]);

    for (const group of byFile.values()) {
      for (const r of group) patch(r.key, { status: "importing", error: undefined });
      const form = new FormData();
      form.append("file", group[0].file);
      form.append("items", JSON.stringify(group.map((r) => {
        const c = toConfig(r);
        return { partIndex: r.partIndex, description: c.description, side: c.side, qty: c.qty, thicknessMm: c.thicknessMm, paintSides: c.paintSides, material: c.material };
      })));
      const res = await fetch(`/api/takeoff/drawings/${drawingId}/import`, { method: "POST", body: form }).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { results?: { partIndex: number; ok: boolean; error?: string }[]; error?: string } | null;
      for (const r of group) {
        const hit = body?.results?.find((x) => x.partIndex === r.partIndex);
        if (res?.ok && hit?.ok) { ok++; patch(r.key, { status: "done" }); }
        else { failed++; patch(r.key, { status: "error", error: hit?.error ?? body?.error ?? "Import failed" }); }
      }
    }
    setBusy(false);
    if (ok) { toast.success(`${ok} part(s) imported`); onImported(); }
    if (failed) toast.error(`${failed} part(s) could not be imported — see the list`);
    else if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Import DXF files</DialogTitle>
          <DialogDescription>
            DXF parts are plates. Size, area and cut-outs are read from the drawing. A sheet with several parts is split into rows, and texts written on it are used: “5mm” over a group sets its thickness, “x6” next to a part sets its qty.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files); }}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
          onClick={() => inputRef.current?.click()}
        >
          <FileUp className="h-4 w-4" />
          Drop DXF files here, or click to choose one or many
        </div>
        <input ref={inputRef} type="file" accept=".dxf" multiple className="hidden"
          onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />

        {fileErrors.length > 0 && (
          <div className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {fileErrors.map((f, i) => (
              <div key={`${f.name}-${i}`} className="flex items-start justify-between gap-2">
                <span><b>{f.name}</b> — {f.error}</span>
                <button type="button" onClick={() => setFileErrors((p) => p.filter((_, j) => j !== i))} title="Dismiss"><X className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Side (all)</Label>
            <Select value={all.side} onValueChange={(v) => applyAll({ side: v as Row["side"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="EXTERNAL">External</SelectItem><SelectItem value="INTERNAL">Internal</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Paint (all)</Label>
            <Select value={all.paint} onValueChange={(v) => applyAll({ paint: v as Row["paintSides"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="1">1 side</SelectItem><SelectItem value="2">2 sides</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Material (all)</Label>
            <Input value={all.material} onChange={(e) => applyAll({ material: e.target.value })} placeholder="Steel" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Default thickness mm</Label>
            <Input type="number" value={all.thk} onChange={(e) => applyAll({ thk: e.target.value })} placeholder="only where not in the drawing" />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium">Side</th>
                  <th className="px-2 py-1.5 font-medium">Paint</th>
                  <th className="px-2 py-1.5 font-medium">Material</th>
                  <th className="w-24 px-2 py-1.5 font-medium">Thk (mm)</th>
                  <th className="w-20 px-2 py-1.5 font-medium">Qty</th>
                  <th className="px-2 py-1.5 text-right font-medium">Size (mm)</th>
                  <th className="px-2 py-1.5 text-right font-medium">Weight (kg)</th>
                  <th className="w-8 px-1 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const ev = evals[i];
                  const locked = r.status === "done" || r.status === "importing";
                  return (
                    <React.Fragment key={r.key}>
                      <tr className={`border-b border-border align-top ${r.status === "done" ? "bg-emerald-500/5 opacity-70" : ""}`}>
                        <td className="min-w-[200px] px-2 py-1.5">
                          <Input disabled={locked} value={r.description} onChange={(e) => patch(r.key, { description: e.target.value })} className="h-8" />
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={r.file.name}>
                            {r.file.name}{r.partsInFile > 1 ? ` · part ${r.partIndex + 1} of ${r.partsInFile}` : ""}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Select disabled={locked} value={r.side} onValueChange={(v) => patch(r.key, { side: v as Row["side"] })}>
                            <SelectTrigger className="h-8 w-[105px]"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="EXTERNAL">External</SelectItem><SelectItem value="INTERNAL">Internal</SelectItem></SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">
                          <Select disabled={locked} value={r.paintSides} onValueChange={(v) => patch(r.key, { paintSides: v as Row["paintSides"] })}>
                            <SelectTrigger className="h-8 w-[95px]"><SelectValue /></SelectTrigger>
                            <SelectContent><SelectItem value="1">1 side</SelectItem><SelectItem value="2">2 sides</SelectItem></SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5"><Input disabled={locked} value={r.material} onChange={(e) => patch(r.key, { material: e.target.value })} className="h-8 w-[110px]" /></td>
                        <td className="px-2 py-1.5">
                          <Input disabled={locked} type="number" value={r.thk} onChange={(e) => patch(r.key, { thk: e.target.value, thkAuto: false })} className="h-8" />
                          {r.thkAuto && <div className="mt-0.5 text-[10px] text-emerald-600">read from file</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          <Input disabled={locked} type="number" min={1} value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value, qtyAuto: false })} className="h-8" />
                          {r.qtyAuto && <div className="mt-0.5 text-[10px] text-emerald-600">read from file</div>}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                          {`${r.bboxW.toFixed(0)} × ${r.bboxH.toFixed(0)}`}
                          {r.unitsWarning ? <span title={r.unitsWarning}><TriangleAlert className="ml-1 inline h-3.5 w-3.5 text-amber-500" /></span> : null}
                        </td>
                        <td className="px-2 py-1.5 text-right text-xs font-medium tabular-nums">{ev && ev.ok ? ev.weightKg.toFixed(1) : "—"}</td>
                        <td className="px-1 py-1.5 text-center">
                          {r.status === "importing" ? <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                            : r.status === "done" ? <CircleCheck className="mx-auto h-4 w-4 text-emerald-600" />
                            : r.status === "error" ? <span title={r.error}><CircleAlert className="mx-auto h-4 w-4 text-destructive" /></span>
                            : !busy ? <button type="button" title="Remove" onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                            : null}
                        </td>
                      </tr>
                      {(r.status === "error" || (ev && !ev.ok)) && !locked && (
                        <tr className="border-b border-border">
                          <td colSpan={9} className="px-2 pb-1.5 text-xs text-destructive">
                            {r.status === "error" ? r.error : (ev && !ev.ok ? ev.error : "")}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {rows.length > 0 ? `${importable.length} of ${rows.length} ready · ${totalWeight.toFixed(1)} kg` : "No files yet"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
            <Button disabled={busy || importable.length === 0} onClick={runImport}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
              Import {importable.length > 0 ? `${importable.length} part(s)` : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
