"use client";
import * as React from "react";
import { Download, FileSpreadsheet, Loader2, X, CircleCheck, CircleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { computeTakeoffPart } from "@/server/calc/takeoff";
import {
  parseTakeoffCsv, csvRowProblem, csvRowToPayload, TAKEOFF_CSV_TEMPLATE,
  type CsvPartRow, type CsvPartType,
} from "./parts-csv";

interface Row extends CsvPartRow {
  key: string;
  status: "idle" | "importing" | "done" | "error";
  error?: string;
}

const TYPE_LABEL: Record<CsvPartType, string> = { HOT_ROLLED: "Hot Rolled", PIPE: "Pipe" };

function weightOf(r: Row, unit: "mm" | "m", drawingId: string): number {
  if (csvRowProblem(r)) return 0;
  const p = csvRowToPayload(r, drawingId, 0, unit);
  return computeTakeoffPart({
    partType: p.partType,
    geometry: p.geometry as Record<string, unknown>,
    qty: p.qty,
    thicknessMm: p.thicknessMm,
    paintSides: p.paintSides,
    areaFormula: null,
  }).weightKg;
}

export function CsvImportDialog({
  open, onOpenChange, drawingId, nextItemNo, onImported,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  drawingId: string;
  nextItemNo: number;
  onImported: () => void;
}) {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [errors, setErrors] = React.useState<string[]>([]);
  const [unit, setUnit] = React.useState<"mm" | "m">("mm");
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const counter = React.useRef(0);
  const [all, setAll] = React.useState({ type: "HOT_ROLLED" as CsvPartType, side: "EXTERNAL" as Row["side"], paint: "2" as Row["paintSides"], material: "" });

  React.useEffect(() => { if (!open) { setRows([]); setErrors([]); setBusy(false); } }, [open]);

  function patch(key: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)));
  }

  async function addFile(file: File) {
    if (!/\.(csv|txt)$/i.test(file.name)) { toast.error("Please choose a .csv file"); return; }
    const parsed = parseTakeoffCsv(await file.text());
    setRows((prev) => [...prev, ...parsed.rows.map((r) => ({ ...r, key: `c${++counter.current}`, status: "idle" as const }))]);
    setErrors((prev) => [...prev, ...parsed.errors]);
    setUnit(parsed.lengthUnit);
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
      if (p.material !== undefined && next.material.trim()) u.material = next.material;
      return { ...r, ...u };
    }));
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([TAKEOFF_CSV_TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "parts-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const problems = rows.map((r) => (r.status === "done" ? null : csvRowProblem(r)));
  const importable = rows.filter((r, i) => r.status !== "done" && problems[i] === null);
  const totalWeight = rows.reduce((s, r, i) => s + (r.status !== "done" && problems[i] === null ? weightOf(r, unit, drawingId) : 0), 0);

  async function runImport() {
    setBusy(true);
    let ok = 0, failed = 0, itemNo = nextItemNo;
    for (const r of importable) {
      patch(r.key, { status: "importing", error: undefined });
      const res = await fetch("/api/takeoff/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(csvRowToPayload(r, drawingId, itemNo, unit)),
      }).catch(() => null);
      if (res?.ok) { ok++; itemNo++; patch(r.key, { status: "done" }); }
      else { failed++; patch(r.key, { status: "error", error: "Could not save this row" }); }
    }
    setBusy(false);
    if (ok) { toast.success(`${ok} part(s) imported`); onImported(); }
    if (failed) toast.error(`${failed} row(s) could not be saved — see the list`);
    else if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Import parts from CSV</DialogTitle>
          <DialogDescription>
            For hot-rolled sections and pipes. Needs at least length and qty columns; unknown columns are ignored. Plates come from DXF files.
          </DialogDescription>
        </DialogHeader>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) void addFile(f); }}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-5 text-sm text-muted-foreground transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-border hover:bg-muted/30"}`}
        >
          <FileSpreadsheet className="h-4 w-4" />
          Drop a CSV here, or click to choose
        </div>
        <input ref={inputRef} type="file" accept=".csv,.txt,text/csv" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void addFile(f); e.target.value = ""; }} />
        <button type="button" onClick={downloadTemplate} className="flex w-fit items-center gap-1.5 text-xs text-primary hover:underline">
          <Download className="h-3.5 w-3.5" /> Download CSV template
        </button>

        {errors.length > 0 && (
          <div className="space-y-0.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {errors.slice(0, 8).map((e, i) => <div key={i}>{e}</div>)}
            {errors.length > 8 && <div>… and {errors.length - 8} more</div>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/20 p-3 sm:grid-cols-5">
          <div className="space-y-1.5">
            <Label className="text-xs">Type (all)</Label>
            <Select value={all.type} onValueChange={(v) => applyAll({ type: v as CsvPartType })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(TYPE_LABEL) as CsvPartType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
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
            <Input value={all.material} onChange={(e) => applyAll({ material: e.target.value })} placeholder="e.g. S235" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Length unit in file</Label>
            <Select value={unit} onValueChange={(v) => setUnit(v as "mm" | "m")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="mm">mm</SelectItem><SelectItem value="m">m</SelectItem></SelectContent>
            </Select>
          </div>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20 text-left text-xs text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Description</th>
                  <th className="px-2 py-1.5 font-medium">Type</th>
                  <th className="px-2 py-1.5 font-medium">Profile</th>
                  <th className="w-24 px-2 py-1.5 font-medium">Length ({unit})</th>
                  <th className="w-16 px-2 py-1.5 font-medium">Qty</th>
                  <th className="w-20 px-2 py-1.5 font-medium">kg/m</th>
                  <th className="w-20 px-2 py-1.5 font-medium">OD (mm)</th>
                  <th className="w-20 px-2 py-1.5 font-medium">Thk (mm)</th>
                  <th className="px-2 py-1.5 font-medium">Material</th>
                  <th className="px-2 py-1.5 font-medium">Side</th>
                  <th className="px-2 py-1.5 font-medium">Paint</th>
                  <th className="px-2 py-1.5 text-right font-medium">Weight (kg)</th>
                  <th className="w-8 px-1 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const locked = r.status === "done" || r.status === "importing";
                  const hr = r.partType === "HOT_ROLLED";
                  const cell = (k: keyof CsvPartRow, w: string, disabled = false, type = "text") => (
                    <Input disabled={locked || disabled} type={type} value={r[k]} onChange={(e) => patch(r.key, { [k]: e.target.value } as Partial<Row>)} className={`h-8 ${w}`} />
                  );
                  return (
                    <React.Fragment key={r.key}>
                      <tr className={`border-b border-border align-top ${r.status === "done" ? "bg-emerald-500/5 opacity-70" : ""}`}>
                        <td className="min-w-[160px] px-2 py-1.5">{cell("description", "")}</td>
                        <td className="px-2 py-1.5">
                          <Select disabled={locked} value={r.partType} onValueChange={(v) => patch(r.key, { partType: v as CsvPartType })}>
                            <SelectTrigger className="h-8 w-[110px]"><SelectValue /></SelectTrigger>
                            <SelectContent>{(Object.keys(TYPE_LABEL) as CsvPartType[]).map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">{cell("profile", "w-[110px]", !hr)}</td>
                        <td className="px-2 py-1.5">{cell("length", "", false, "number")}</td>
                        <td className="px-2 py-1.5">{cell("qty", "", false, "number")}</td>
                        <td className="px-2 py-1.5">{cell("weightPerMeter", "", !hr, "number")}</td>
                        <td className="px-2 py-1.5">{cell("od", "", hr, "number")}</td>
                        <td className="px-2 py-1.5">{cell("thickness", "", hr, "number")}</td>
                        <td className="px-2 py-1.5">{cell("material", "w-[100px]")}</td>
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
                        <td className="px-2 py-1.5 text-right text-xs font-medium tabular-nums">{problems[i] === null && r.status !== "done" ? weightOf(r, unit, drawingId).toFixed(1) : "—"}</td>
                        <td className="px-1 py-1.5 text-center">
                          {r.status === "importing" ? <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                            : r.status === "done" ? <CircleCheck className="mx-auto h-4 w-4 text-emerald-600" />
                            : r.status === "error" ? <span title={r.error}><CircleAlert className="mx-auto h-4 w-4 text-destructive" /></span>
                            : !busy ? <button type="button" title="Remove" onClick={() => setRows((p) => p.filter((x) => x.key !== r.key))} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                            : null}
                        </td>
                      </tr>
                      {(r.status === "error" || problems[i]) && !locked && (
                        <tr className="border-b border-border">
                          <td colSpan={13} className="px-2 pb-1.5 text-xs text-destructive">{r.status === "error" ? r.error : problems[i]}</td>
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
            {rows.length > 0 ? `${importable.length} of ${rows.length} ready · ${totalWeight.toFixed(1)} kg` : "No file yet"}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>
            <Button disabled={busy || importable.length === 0} onClick={runImport}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              Import {importable.length > 0 ? `${importable.length} part(s)` : ""}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
