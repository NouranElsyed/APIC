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
import { parseDxf, type DxfGeometryResult } from "@/server/calc/dxf";
import { computeTakeoffPart } from "@/server/calc/takeoff";
import { buildPartFromDxf, guessFromFileName, type ImportPartType, type ImportRowConfig } from "@/server/calc/dxf-import";

interface Row {
  key: string;
  file: File;
  dxf: DxfGeometryResult | null; // null while parsing
  description: string;
  partType: ImportPartType;
  side: "INTERNAL" | "EXTERNAL";
  paintSides: "1" | "2";
  qty: string;
  thk: string;
  material: string;
  profile: string;
  wpm: string;
  status: "idle" | "importing" | "done" | "error";
  error?: string;
}

const TYPE_LABEL: Record<ImportPartType, string> = { PLATE: "Plate", HOT_ROLLED: "Hot Rolled" };

const toNum = (v: string): number | null => {
  const x = Number(v);
  return v.trim() !== "" && Number.isFinite(x) ? x : null;
};

function toConfig(r: Row): ImportRowConfig {
  return {
    description: r.description,
    partType: r.partType,
    side: r.side,
    qty: Number(r.qty),
    thicknessMm: toNum(r.thk),
    paintSides: r.paintSides === "1" ? 1 : 2,
    material: r.material,
    profile: r.profile,
    weightPerMeter: toNum(r.wpm),
  };
}

// Live result for a row: either the computed numbers or why it can't be imported.
function evaluate(r: Row) {
  if (!r.dxf) return { ok: false as const, error: "Reading…" };
  const built = buildPartFromDxf(r.dxf, toConfig(r));
  if (!built.ok) return built;
  const i = built.input as Record<string, unknown>;
  const c = computeTakeoffPart({
    partType: i.partType as "PLATE" | "HOT_ROLLED",
    geometry: i.geometry as Record<string, unknown>,
    qty: i.qty as number,
    thicknessMm: (i.thicknessMm as number | null) ?? null,
    paintSides: i.paintSides as number,
    areaFormula: null,
  });
  return { ok: true as const, weightKg: c.weightKg, area: c.totalArea };
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
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // "Set for all" bar
  const [all, setAll] = React.useState({ type: "PLATE" as ImportPartType, side: "EXTERNAL" as Row["side"], paint: "2" as Row["paintSides"], material: "Steel", thk: "" });

  React.useEffect(() => { if (!open) { setRows([]); setBusy(false); } }, [open]);

  function patch(key: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  async function addFiles(list: FileList | File[]) {
    const files = [...list].filter((f) => f.name.toLowerCase().endsWith(".dxf"));
    if (files.length === 0) { toast.error("Only .dxf files are accepted"); return; }
    const fresh: Row[] = files.map((file, i) => {
      const g = guessFromFileName(file.name);
      return {
        key: `${Date.now()}-${i}-${file.name}`,
        file,
        dxf: null,
        description: g.description,
        partType: all.type,
        side: all.side,
        paintSides: all.paint,
        qty: String(g.qty ?? 1),
        thk: g.thicknessMm !== undefined ? String(g.thicknessMm) : all.thk,
        material: all.material,
        profile: "",
        wpm: "",
        status: "idle",
      };
    });
    setRows((prev) => [...prev, ...fresh]);
    // Parse in the browser for the preview; the server re-parses on import.
    for (const row of fresh) {
      try {
        const dxf = parseDxf(await row.file.text());
        patch(row.key, { dxf });
      } catch {
        patch(row.key, { dxf: { valid: false, errorMessage: "Could not read file", unitsDetected: "unknown", areaSqm: null, bboxWidthMm: null, bboxHeightMm: null, outerContourCount: 0, holeCount: 0, unitsWarning: null, geometry: null, parts: [] } });
      }
    }
  }

  function applyAll(p: Partial<typeof all>) {
    const next = { ...all, ...p };
    setAll(next);
    setRows((prev) => prev.map((r) => {
      if (r.status === "done") return r;
      const u: Partial<Row> = {};
      if (p.type !== undefined) u.partType = next.type;
      if (p.side !== undefined) u.side = next.side;
      if (p.paint !== undefined) u.paintSides = next.paint;
      if (p.material !== undefined) u.material = next.material;
      if (p.thk !== undefined) u.thk = next.thk;
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
    for (const row of importable) {
      patch(row.key, { status: "importing", error: undefined });
      const form = new FormData();
      form.append("file", row.file);
      form.append("config", JSON.stringify(toConfig(row)));
      const res = await fetch(`/api/takeoff/drawings/${drawingId}/import`, { method: "POST", body: form }).catch(() => null);
      if (res?.ok) { ok++; patch(row.key, { status: "done" }); }
      else {
        failed++;
        const body = await res?.json().catch(() => null);
        patch(row.key, { status: "error", error: body?.error ?? "Import failed" });
      }
    }
    setBusy(false);
    if (ok) { toast.success(`${ok} part(s) imported`); onImported(); }
    if (failed) toast.error(`${failed} file(s) could not be imported — see the list`);
    else if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Import DXF files</DialogTitle>
          <DialogDescription>
            Each file becomes one item. Size, area and cut-outs are read from the drawing; set type, side, thickness and qty below — for all files at once or per row.
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

        <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Type (all)</Label>
            <Select value={all.type} onValueChange={(v) => applyAll({ type: v as ImportPartType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(TYPE_LABEL) as ImportPartType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
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
            <Label className="text-xs">Thickness mm (all)</Label>
            <Input type="number" value={all.thk} onChange={(e) => applyAll({ thk: e.target.value })} placeholder="e.g. 5" />
          </div>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Side</th>
                  <th className="px-2 py-1.5 font-medium">Paint</th>
                  <th className="px-2 py-1.5 font-medium">Material</th>
                  <th className="w-20 px-2 py-1.5 font-medium">Thk (mm)</th>
                  <th className="w-16 px-2 py-1.5 font-medium">Qty</th>
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
                          <div className="mt-0.5 truncate text-[11px] text-muted-foreground" title={r.file.name}>{r.file.name}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Select disabled={locked} value={r.partType} onValueChange={(v) => patch(r.key, { partType: v as ImportPartType })}>
                            <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                            <SelectContent>{(Object.keys(TYPE_LABEL) as ImportPartType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                          </Select>
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
                        <td className="px-2 py-1.5"><Input disabled={locked} type="number" value={r.thk} onChange={(e) => patch(r.key, { thk: e.target.value })} className="h-8" /></td>
                        <td className="px-2 py-1.5"><Input disabled={locked} type="number" min={1} value={r.qty} onChange={(e) => patch(r.key, { qty: e.target.value })} className="h-8" /></td>
                        <td className="whitespace-nowrap px-2 py-1.5 text-right text-xs tabular-nums text-muted-foreground">
                          {r.dxf?.valid ? `${r.dxf.bboxWidthMm?.toFixed(0)} × ${r.dxf.bboxHeightMm?.toFixed(0)}` : "—"}
                          {r.dxf?.valid && r.dxf.unitsWarning ? (
                            <span title={r.dxf.unitsWarning}><TriangleAlert className="ml-1 inline h-3.5 w-3.5 text-amber-500" /></span>
                          ) : null}
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
                      {r.partType === "HOT_ROLLED" && !locked && (
                        <tr className="border-b border-border bg-muted/10">
                          <td colSpan={10} className="px-2 py-1.5">
                            <div className="flex flex-wrap items-center gap-3 text-xs">
                              <span className="text-muted-foreground">Length is taken from the longest side of the DXF.</span>
                              <Input value={r.profile} onChange={(e) => patch(r.key, { profile: e.target.value })} placeholder="Profile, e.g. IPE 120" className="h-8 w-44" />
                              <Input type="number" value={r.wpm} onChange={(e) => patch(r.key, { wpm: e.target.value })} placeholder="kg / m" className="h-8 w-28" />
                            </div>
                          </td>
                        </tr>
                      )}
                      {(r.status === "error" || (ev && !ev.ok && r.dxf)) && !locked && (
                        <tr className="border-b border-border">
                          <td colSpan={10} className="px-2 pb-1.5 text-xs text-destructive">
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
