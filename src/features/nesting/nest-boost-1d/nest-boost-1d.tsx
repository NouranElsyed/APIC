"use client";
import * as React from "react";
import { ChevronDown, Download, FileSpreadsheet, FolderInput, Gauge, Info, Loader2, PackageCheck, Plus, Recycle, Ruler, Scissors, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTakeoffProject } from "@/features/takeoff/project-context";
import type { TakeoffDrawingRow } from "@/features/takeoff/types";
import { PARTS_CSV_TEMPLATE, parsePartsCsv } from "../csv-parts";
import { AutosaveBadge, useNestingAutosave } from "../use-nesting-autosave";
import { dxfToPiece } from "../dxf-piece";
import { nestKindOf, partTo1DPiece } from "../part-routing";
import { pieceColor, renderBarPng } from "../report/draw-1d";
import { register1D } from "../report/report-store";
import type { Report1DInput } from "../report/report-1d";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyPanel, KpiTile, PaneTabs, Panel, stepStates, WorkflowStepper, WorkspaceHeader, type WorkflowStep } from "../ui/workspace-ui";
import {
  addPiece,
  addSource,
  addSourceLengths,
  barStats,
  barTrims,
  buildCutList,
  buildCutListCsv,
  DEFAULT_PART_TYPE_1D,
  lotKey,
  minBarLength,
  overallStats,
  parseSourceLengths,
  PART_TYPES_1D,
  resizeBar,
  runOptimize1D,
  type Bar,
  type Counters1D,
  type PartType1D,
  type Piece1D,
  type Result1D,
  type Settings1D,
  type Source1D,
} from "./engine";

const selectCls = "h-8 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring";

function TypeSelect({ value, onChange, className = "" }: { value: PartType1D | undefined; onChange: (v: PartType1D) => void; className?: string }) {
  return (
    <select className={`${selectCls} ${className}`} value={value ?? DEFAULT_PART_TYPE_1D} onChange={(e) => onChange(e.target.value as PartType1D)}>
      {PART_TYPES_1D.map((t) => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function BarStrip({ b, S }: { b: Bar; S: Settings1D }) {
  const L = b.length ?? b.sourceLength;
  const st = barStats(b, S);
  const t = barTrims(b, S);
  return (
    <div className="relative h-10 w-full overflow-hidden rounded-md border border-border bg-secondary">
      <div className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${(100 * t.left) / L}%` }} />
      <div className="absolute inset-y-0 right-0 bg-muted" style={{ width: `${(100 * t.right) / L}%` }} />
      {b.cuts.map((c, i) => (
        <div
          key={i}
          title={`#${c.piece.sn} ${c.piece.name} — ${Math.round(c.piece.length)} mm`}
          className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-white"
          style={{
            left: `${(100 * (t.left + c.pos)) / L}%`,
            width: `${(100 * c.piece.length) / L}%`,
            background: pieceColor(c.piece.sn),
            borderLeft: "1px solid rgba(255,255,255,.6)",
          }}
        >
          {c.piece.length / L > 0.07 ? `#${c.piece.sn} · ${Math.round(c.piece.length)}` : `#${c.piece.sn}`}
        </div>
      ))}
      {st.isRemnant && st.rest > 0 && (
        <div
          className="absolute inset-y-0 flex items-center justify-center bg-emerald-500/30 text-[9px] font-semibold text-emerald-900"
          style={{ left: `${(100 * (t.left + st.usedLength)) / L}%`, width: `${(100 * st.rest) / L}%` }}
          title={`Reusable remnant — ${st.rest} mm`}
        >
          rest
        </div>
      )}
    </div>
  );
}

function LayoutCard({
  index,
  bar,
  repeat,
  S,
  onResize,
  onReset,
}: {
  index: number;
  bar: Bar;
  repeat: number;
  S: Settings1D;
  onResize: (l: number) => void;
  onReset: () => void;
}) {
  const L = bar.length ?? bar.sourceLength;
  const st = barStats(bar, S);
  const trimmed = bar.length !== undefined;
  const legend = new Map<number, { piece: (typeof bar.cuts)[number]["piece"]; n: number }>();
  for (const c of bar.cuts) {
    const e = legend.get(c.piece.sn);
    if (e) e.n++;
    else legend.set(c.piece.sn, { piece: c.piece, n: 1 });
  }
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <b className="text-foreground">
            Layout {index + 1} — {bar.profile || "profile ?"} {bar.material ? `— ${bar.material}` : ""}
          </b>{" "}
          — × {repeat} bar(s) • {st.pieces} pcs/bar • rest {st.rest} mm{st.isRemnant ? " (reusable)" : ""} • utilization{" "}
          {st.utilization.toFixed(1)}%
        </span>
        <span className="flex items-center gap-1">
          Cut length
          <Input
            type="number" min={1} className="h-7 w-24"
            value={Math.round(L)}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) onResize(v);
            }}
          />
          mm
        </span>
        <Button variant="ghost" size="sm" className="h-7" title="Shrink to just fit its cuts, to cut less material / less scrap" onClick={() => onResize(minBarLength(bar, S))}>
          Fit to cuts
        </Button>
        {trimmed && (
          <Button variant="ghost" size="sm" className="h-7" onClick={onReset}>
            Reset to stock length
          </Button>
        )}
      </div>
      <BarStrip b={bar} S={S} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        {[...legend.values()].map(({ piece, n }) => (
          <span key={piece.sn} className="inline-flex items-center gap-1">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: pieceColor(piece.sn) }} />
            #{piece.sn} {piece.name} · {Math.round(piece.length)} mm × {n}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-muted ring-1 ring-border" /> trim
        </span>
      </div>
    </div>
  );
}

const DEFAULT_SETTINGS: Settings1D = {
  kerf: 3,
  leftTrim: 10,
  rightTrim: 10,
  gripping: 0,
  minimizeLayoutCount: false,
  maxPartsInLayout: 0,
  maxDistinctLengthsInLayout: 0,
  minLengthDiffInLayout: 0,
  remnantMinLength: 300,
  restrictedRestFrom: 0,
  restrictedRestTo: 0,
};

export function NestBoost1D() {
  const [pieces, setPieces] = React.useState<Piece1D[]>([]);
  const [sources, setSources] = React.useState<Source1D[]>([]);
  const piecesRef = React.useRef<Piece1D[]>([]);
  React.useEffect(() => {
    piecesRef.current = pieces;
  }, [pieces]);
  const sourcesRef = React.useRef<Source1D[]>([]);
  React.useEffect(() => {
    sourcesRef.current = sources;
  }, [sources]);
  const pieceCounters = React.useRef<Counters1D>({ id: 0, sn: 0 });
  const sourceCounters = React.useRef<Counters1D>({ id: 100000, sn: 0 });

  const { projectId, nestingQueue1D, clearNestingQueue1D, ensureWorkspace, consumeFresh, workspaceId, workspaceLabel } = useTakeoffProject();
  const [reporting, setReporting] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [importMsg, setImportMsg] = React.useState("");
  // Takeoff part ids already imported, so pressing Import twice never doubles quantities.
  const importedIds = React.useRef<Set<string>>(new Set());

  const [pieceForm, setPieceForm] = React.useState<{ name: string; profile: string; material: string; length: string; qty: string; partType: PartType1D }>({
    name: "", profile: "", material: "", length: "", qty: "1", partType: DEFAULT_PART_TYPE_1D,
  });
  // Manual stock entry: one profile + material, any number of bar lengths ("6000, 9000x10, 12000").
  const [srcForm, setSrcForm] = React.useState({ profile: "", material: "", lengths: "", qty: "", cost: "" });
  const [srcMsg, setSrcMsg] = React.useState("");
  // DXF import options: type given to every imported drawing, and the drawing units ("auto" = read from the file).
  const [dxfType, setDxfType] = React.useState<PartType1D>(DEFAULT_PART_TYPE_1D);
  const [dxfUnits, setDxfUnits] = React.useState("auto");
  const [dxfBusy, setDxfBusy] = React.useState(false);

  const [cfg, setCfg] = React.useState({
    kerf: String(DEFAULT_SETTINGS.kerf),
    leftTrim: String(DEFAULT_SETTINGS.leftTrim),
    rightTrim: String(DEFAULT_SETTINGS.rightTrim),
    gripping: String(DEFAULT_SETTINGS.gripping),
    minimizeLayoutCount: DEFAULT_SETTINGS.minimizeLayoutCount,
    maxPartsInLayout: "",
    maxDistinctLengthsInLayout: "",
    minLengthDiffInLayout: "",
    remnantMinLength: String(DEFAULT_SETTINGS.remnantMinLength),
    restrictedRestFrom: "",
    restrictedRestTo: "",
  });

  const [result, setResult] = React.useState<Result1D | null>(null);
  const [resS, setResS] = React.useState<Settings1D | null>(null);
  const [status, setStatus] = React.useState("");
  const [confirmReset, setConfirmReset] = React.useState(false);
  // Layout only: which tab of the left rail / of the lower panel is open (every tab stays mounted)
  const [railTab, setRailTab] = React.useState<"import" | "settings">("import");
  const [mainTab, setMainTab] = React.useState<"parts" | "stock">("parts");
  const [, bumpV] = React.useReducer((v: number) => v + 1, 0);

  /**
   * Makes sure every profile + material used by the parts has a source row.
   * New rows are created WITHOUT a length (length 0 = blank) so the user must type the stock bar length.
   */
  const ensureSourcesFor = (parts: Piece1D[]) => {
    const have = new Set(sourcesRef.current.map((s) => lotKey(s.profile, s.material)));
    let next = sourcesRef.current;
    for (const p of parts) {
      const key = lotKey(p.profile, p.material);
      if (have.has(key)) continue;
      have.add(key);
      next = addSource(next, { profile: p.profile, material: p.material, length: 0, qty: null, cost: 0, description: "" }, sourceCounters.current);
    }
    if (next !== sourcesRef.current) {
      sourcesRef.current = next;
      setSources(next);
    }
  };

  const addPieceRow = () => {
    const length = Number(pieceForm.length);
    if (!(length > 0)) {
      setStatus("Enter a cut length in mm for the part.");
      return;
    }
    const nextPieces = addPiece(
      piecesRef.current,
      { name: pieceForm.name, profile: pieceForm.profile, material: pieceForm.material, length, qty: Number(pieceForm.qty) || 1, partType: pieceForm.partType },
      pieceCounters.current,
    );
    piecesRef.current = nextPieces;
    setPieces(nextPieces);
    ensureSourcesFor(nextPieces);
    setPieceForm((f) => ({ ...f, name: "", length: "", qty: "1" }));
    setStatus("");
  };

  /** Reads one or many DXF drawings and adds one part per file (cut length = longer side of the outline). */
  async function handleDxf(files: File[]) {
    files = files.filter((f) => /\.dxf$/i.test(f.name));
    if (!files.length) {
      toast.error("Choose one or more .dxf files");
      return;
    }
    setDxfBusy(true);
    try {
      const scale = dxfUnits === "auto" ? null : Number(dxfUnits);
      const parsedDxf: { f: File; r: ReturnType<typeof dxfToPiece> }[] = [];
      for (const f of files) parsedDxf.push({ f, r: dxfToPiece(await f.text(), f.name, scale) });
      await ensureWorkspaceFor(parsedDxf.some((x) => !("error" in x.r)), parsedDxf.find((x) => !("error" in x.r))?.f.name);
      let next = piecesRef.current;
      const lines: string[] = [];
      let added = 0;
      for (const { f, r } of parsedDxf) {
        if ("error" in r) {
          lines.push(`${f.name}: skipped — ${r.error}`);
          continue;
        }
        next = addPiece(next, { name: r.name, profile: "", material: "", length: r.length, qty: 1, partType: dxfType }, pieceCounters.current);
        added++;
        lines.push(`${f.name}: ${r.length} mm long × ${r.width} mm wide (units: ${r.unitsLabel})${r.contours > 1 ? `, ${r.contours} contours — largest one used` : ""}`);
      }
      if (added) {
        piecesRef.current = next;
        setPieces(next);
        ensureSourcesFor(next);
        setResult(null);
        toast.success(`Imported ${added} part(s) from DXF — set the profile, material and qty in the list`);
      } else toast.warning("No parts were imported from the DXF files");
      setImportMsg(lines.join("\n"));
    } finally {
      setDxfBusy(false);
    }
  }

  /** Nothing open: an import with usable parts starts a new entry in the user's history (name + date), auto-saved from now on. */
  async function ensureWorkspaceFor(hasParts: boolean, fileName?: string) {
    if (workspaceId || !hasParts) return;
    try {
      await ensureWorkspace(fileName?.replace(/\.(dxf|csv)$/i, ""));
    } catch (err) {
      toast.error(`${err instanceof Error ? err.message : "Could not save this import to your history"} — it will not be auto-saved`);
    }
  }

  // ---- Auto-save of the whole 1D workspace (parts, sources, settings, result) to the selected project.
  const autosave = useNestingAutosave({
    kind: "1D",
    workspaceId,
    consumeFresh,
    capture: () => ({
      v: 1, pieces: piecesRef.current, sources: sourcesRef.current, cfg, result, resS,
      pieceCounters: pieceCounters.current, sourceCounters: sourceCounters.current, importedIds: [...importedIds.current],
    }),
    restore: (data) => {
      const d = data as {
        v?: number; pieces?: Piece1D[]; sources?: Source1D[]; cfg?: typeof cfg; result?: Result1D | null; resS?: Settings1D | null;
        pieceCounters?: { id: number; sn: number }; sourceCounters?: { id: number; sn: number }; importedIds?: string[];
      } | null;
      const ok = !!d && d.v === 1 && Array.isArray(d.pieces) && Array.isArray(d.sources);
      const pcs = ok ? d!.pieces! : [];
      const srcs = ok ? d!.sources! : [];
      piecesRef.current = pcs;
      sourcesRef.current = srcs;
      setPieces(pcs);
      setSources(srcs);
      pieceCounters.current = ok && d!.pieceCounters ? d!.pieceCounters : { id: Math.max(0, ...pcs.map((p) => p.id)), sn: Math.max(0, ...pcs.map((p) => p.sn)) };
      sourceCounters.current = ok && d!.sourceCounters ? d!.sourceCounters : { id: Math.max(100000, ...srcs.map((s) => s.id)), sn: Math.max(0, ...srcs.map((s) => s.sn)) };
      importedIds.current = new Set(ok ? d!.importedIds ?? [] : []);
      if (ok && d!.cfg) setCfg((c) => ({ ...c, ...d!.cfg }));
      setResult(ok ? d!.result ?? null : null);
      setResS(ok ? d!.resS ?? null : null);
      setStatus("");
      setImportMsg(ok ? `Restored the saved nest (${pcs.length} part row(s)).` : "");
    },
    deps: [pieces, sources, cfg, result, resS],
  });

  async function handleCsv(files: File[]) {
    let added = 0;
    const lines: string[] = [];
    const parsedCsv: { f: File; r: ReturnType<typeof parsePartsCsv> }[] = [];
    for (const f of files) parsedCsv.push({ f, r: parsePartsCsv(await f.text()) });
    await ensureWorkspaceFor(parsedCsv.some((x) => x.r.pieces.length > 0), parsedCsv.find((x) => x.r.pieces.length > 0)?.f.name);
    let next: Piece1D[] = piecesRef.current;
    for (const { f, r } of parsedCsv) {
      for (const p of r.pieces) next = addPiece(next, p, pieceCounters.current);
      added += r.pieces.length;
      lines.push(`${f.name}: ${r.pieces.length} part(s) imported` + (r.errors.length ? `, ${r.errors.length} row(s) skipped:\n  ${r.errors.join("\n  ")}` : ""));
    }
    if (added) {
      piecesRef.current = next;
      setPieces(next);
      ensureSourcesFor(next);
      setResult(null);
      toast.success(`Imported ${added} part(s) from CSV — enter the stock bar length for each source`);
    } else toast.warning("No parts were imported");
    setImportMsg(lines.join("\n"));
  }

  /**
   * Pulls every non-plate part (hot rolled, pipe, ...) of the selected project
   * from Standard Calculations. `onlyIds` = parts sent one by one; omitted = all.
   */
  const importFromProject = React.useCallback(
    async (onlyIds?: string[]) => {
      if (!projectId) {
        toast.error("Select a project first");
        return;
      }
      setImporting(true);
      try {
        const res = await fetch(`/api/takeoff/drawings?projectId=${projectId}`);
        if (!res.ok) throw new Error("Failed to load the parts list");
        const drawings: TakeoffDrawingRow[] = await res.json();
        const wanted = onlyIds ? new Set(onlyIds) : null;
        let next = piecesRef.current;
        let ok = 0;
        const done: string[] = [];
        const skipped: string[] = [];
        for (const d of drawings) {
          for (const part of d.parts) {
            if (wanted && !wanted.has(part.id)) continue;
            if (nestKindOf(part.partType) !== "1D") continue; // plates belong to the 2D tool
            const label = `${d.drawingNumber} #${part.itemNo} ${part.description}`;
            if (importedIds.current.has(part.id)) { skipped.push(`${label}: already imported`); continue; }
            const r = partTo1DPiece(part);
            if ("error" in r) { skipped.push(`${label}: ${r.error}`); continue; }
            next = addPiece(next, { ...r.piece, name: label }, pieceCounters.current);
            importedIds.current.add(part.id);
            ok++;
            done.push(`${label}: ${r.piece.qty} × ${r.piece.length} mm ${r.piece.profile}`);
          }
        }
        if (ok) {
          piecesRef.current = next;
          setPieces(next);
          ensureSourcesFor(next);
          setResult(null);
          toast.success(`Imported ${ok} part(s) from Standard Calculations`);
        } else toast.warning("No parts were imported");
        setImportMsg((done.join("\n") + (skipped.length ? `\nSkipped:\n${skipped.join("\n")}` : "")).trim() || "Nothing to import.");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      } finally {
        setImporting(false);
      }
    },
    [projectId],
  );

  // Parts sent one-by-one from the Standard Calculations tab.
  React.useEffect(() => {
    if (!nestingQueue1D.length || !projectId) return;
    const ids = nestingQueue1D;
    clearNestingQueue1D();
    importFromProject(ids);
  }, [nestingQueue1D, projectId, clearNestingQueue1D, importFromProject]);

  const updatePiece = (id: number, patch: Partial<Piece1D>) => {
    const next = piecesRef.current.map((p) => (p.id === id ? { ...p, ...patch } : p));
    piecesRef.current = next;
    setPieces(next);
    // A new profile / material needs its own stock row (Sources) to cut from.
    if ("profile" in patch || "material" in patch) ensureSourcesFor(next);
  };
  const removePiece = (id: number) => {
    setPieces((prev) => prev.filter((p) => p.id !== id));
    setResult(null);
  };
  const updateSource = (id: number, patch: Partial<Source1D>) => setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const addSourceRows = () => {
    const { items, invalid } = parseSourceLengths(srcForm.lengths, srcForm.qty.trim() === "" ? null : Number(srcForm.qty));
    if (invalid.length) {
      setSrcMsg(`Cannot read: ${invalid.join(", ")}. Use lengths in mm like "6000, 9000x10, 12000" (x = how many bars).`);
      return;
    }
    if (!items.length) {
      setSrcMsg("Enter at least one stock bar length in mm.");
      return;
    }
    const next = addSourceLengths(
      sourcesRef.current,
      { profile: srcForm.profile, material: srcForm.material, lengths: items, cost: Number(srcForm.cost) || 0 },
      sourceCounters.current,
    );
    sourcesRef.current = next;
    setSources(next);
    setResult(null);
    setSrcMsg("");
    setSrcForm((f) => ({ ...f, lengths: "" }));
  };
  /** Another (blank) stock length for the same profile + material as an existing row. */
  const addLengthLike = (s: Source1D) => {
    const next = addSource(sourcesRef.current, { profile: s.profile, material: s.material, length: 0, qty: null, cost: s.cost, description: "" }, sourceCounters.current);
    sourcesRef.current = next;
    setSources(next);
  };
  const removeSource = (id: number) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    setResult(null);
  };

  const resetAll = () => {
    setPieces([]);
    setSources([]);
    piecesRef.current = [];
    sourcesRef.current = [];
    pieceCounters.current = { id: 0, sn: 0 };
    sourceCounters.current = { id: 100000, sn: 0 };
    importedIds.current = new Set();
    setImportMsg("");
    setResult(null);
    setResS(null);
    setStatus("");
    setConfirmReset(false);
  };

  const start = () => {
    const S: Settings1D = {
      kerf: Number(cfg.kerf) || 0,
      leftTrim: Number(cfg.leftTrim) || 0,
      rightTrim: Number(cfg.rightTrim) || 0,
      gripping: Number(cfg.gripping) || 0,
      minimizeLayoutCount: cfg.minimizeLayoutCount,
      maxPartsInLayout: Number(cfg.maxPartsInLayout) || 0,
      maxDistinctLengthsInLayout: Number(cfg.maxDistinctLengthsInLayout) || 0,
      minLengthDiffInLayout: Number(cfg.minLengthDiffInLayout) || 0,
      remnantMinLength: Number(cfg.remnantMinLength) || 0,
      restrictedRestFrom: Number(cfg.restrictedRestFrom) || 0,
      restrictedRestTo: Number(cfg.restrictedRestTo) || 0,
    };
    if (S.kerf < 0 || S.leftTrim < 0 || S.rightTrim < 0 || S.gripping < 0) {
      setStatus("Check the kerf, trim and gripping values.");
      return;
    }
    if (!pieces.some((p) => p.qty > 0)) {
      setStatus("Add at least one part with a quantity above 0.");
      return;
    }
    if (!sources.length) {
      setStatus("Add at least one stock length (Source) to cut from.");
      return;
    }
    const missing = sources.filter((x) => !(x.length > 0));
    if (missing.length) {
      setStatus(`Enter the stock bar length (mm) for: ${missing.map((x) => [x.profile, x.material].filter(Boolean).join(" ") || `source #${x.sn}`).join(", ")}`);
      return;
    }
    const res = runOptimize1D(pieces, sources, S);
    setResS(S);
    setResult(res);
    setStatus("");
  };

  function download(name: string, text: string, type: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const canExport = !!result && result.layouts.length > 0;

  /** Report input for this tool's current result (also used by the combined 1D+2D report). */
  const getReportInput = React.useCallback((): Report1DInput | null => {
    if (!result || !resS) return null;
    const S = resS;
    return {
      projectName: workspaceLabel || undefined,
      result,
      S,
      pieces,
      sources,
      renderBar: (i) => renderBarPng(result.layouts[i].bars[0], S),
    };
  }, [result, resS, pieces, sources, workspaceLabel]);

  // Lets the combined 1D+2D report button reach this tool's latest result.
  React.useEffect(() => {
    register1D(canExport ? getReportInput : null);
    return () => register1D(null);
  }, [canExport, getReportInput]);

  /** Excel report: bars used, scrap, parts cut, cut list and a picture of every layout. */
  async function exportReport() {
    const input = getReportInput();
    if (!input) return;
    setReporting(true);
    try {
      const [{ buildReport1D }, { saveBlob }] = await Promise.all([import("../report/report-1d"), import("../report/excel-common")]);
      saveBlob(await buildReport1D(input), "nesting-report-1d.xlsx");
      toast.success("Report downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the report");
    } finally {
      setReporting(false);
    }
  }

  const summary = result && resS ? overallStats(result, sources) : null;

  // ---- workspace chrome (display only): workflow steps, header exports, result numbers
  const stockOk = pieces.length > 0 && sources.length > 0 && sources.every((x) => x.length > 0);
  const wfState = stepStates([pieces.length > 0, stockOk, !!result, false]);
  const wfSteps: WorkflowStep[] = [
    { label: "Import Parts", hint: pieces.length ? `${pieces.length} part row${pieces.length === 1 ? "" : "s"}` : "CSV, DXF or manual", state: wfState[0] },
    { label: "Configure Stock", hint: stockOk ? `${sources.length} stock row${sources.length === 1 ? "" : "s"}` : sources.some((x) => !(x.length > 0)) ? "Enter the bar lengths" : "Stock lengths and cutting settings", state: wfState[1] },
    { label: "Nest Parts", hint: result ? `${summary?.bars ?? 0} bar(s)` : pieces.length ? "Ready to run" : "After import", state: wfState[2] },
    { label: "Review Results", hint: canExport ? "Cut list and report" : "After optimization", state: wfState[3] },
  ];
  const stockMissing = sources.some((x) => !(x.length > 0));

  return (
    <div className="space-y-4">
      <WorkspaceHeader
        icon={<Ruler className="h-5 w-5" />}
        title="1D Nesting"
        subtitle="Optimize the cutting of bars, pipes, angles and profiles."
        actions={
          <>
            {workspaceId && <AutosaveBadge state={autosave.state} savedAt={autosave.savedAt} projectLabel={workspaceLabel} />}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button><Download /> Export <ChevronDown /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem disabled={!canExport} onSelect={() => result && resS && download("cut-list.txt", buildCutList(result, resS), "text/plain")}>
                  <Download /> Cut list (.txt)
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canExport} onSelect={() => result && resS && download("cut-list.csv", buildCutListCsv(result, resS), "text/csv")}>
                  <Download /> Cut list (.csv)
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canExport || reporting} onSelect={() => void exportReport()}>
                  <FileSpreadsheet /> Excel report (.xlsx)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <WorkflowStepper steps={wfSteps} />

      <div className="grid gap-4 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] xl:items-start">
        <aside className="min-w-0">
          <div className="rounded-xl border border-border bg-card shadow-sm">
            <PaneTabs
              value={railTab}
              onValueChange={(v) => setRailTab(v as "import" | "settings")}
              listClassName="px-2 pt-1"
              paneClassName="p-4"
              tabs={[
                { id: "import", label: "1 · Import parts", content: <div>
          {!workspaceId && (
            <p className="mb-3 rounded-lg bg-muted/40 p-2 text-xs text-muted-foreground">No project selected — importing a CSV / DXF saves it to your history (name + date) and auto-saves into it. Use “Save as project” above when you are done.</p>
          )}
          <label
            className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border p-4 text-center text-sm text-muted-foreground hover:bg-secondary"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleCsv(Array.from(e.dataTransfer.files).filter((f) => /\.csv$/i.test(f.name)));
            }}
          >
            <Upload className="h-5 w-5" />
            Drop a CSV here or click
            <span className="text-[11px]">columns: name, profile, material, length_mm, qty</span>
            <input
              type="file"
              accept=".csv,text/csv"
              multiple
              hidden
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                e.target.value = "";
                handleCsv(fs);
              }}
            />
          </label>
          <Button variant="ghost" size="sm" className="mt-1 h-7" onClick={() => download("parts-template.csv", PARTS_CSV_TEMPLATE, "text/csv")}>
            <FileSpreadsheet /> Download CSV template
          </Button>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={!projectId || importing}
            onClick={() => importFromProject()}
            title="Import every non-plate part (hot rolled, pipe...) of the selected project with its length and quantity"
          >
            {importing ? <Loader2 className="animate-spin" /> : <FolderInput />} Import bars/pipes from Standard Calculations
          </Button>
          {!projectId && <p className="mt-1 text-xs text-muted-foreground">Select a project above to enable this.</p>}
          {importMsg && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{importMsg}</pre>}
                </div> },
                { id: "settings", label: "2 · Cutting settings", content: <div>
          <div className="mb-1 text-[11px] font-semibold text-muted-foreground">Basic</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Saw kerf (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.kerf} onChange={(e) => setCfg((c) => ({ ...c, kerf: e.target.value }))} />
            </Field>
            <Field label="Gripping (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.gripping} onChange={(e) => setCfg((c) => ({ ...c, gripping: e.target.value }))} />
            </Field>
            <Field label="Left trim cut (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.leftTrim} onChange={(e) => setCfg((c) => ({ ...c, leftTrim: e.target.value }))} />
            </Field>
            <Field label="Right trim cut (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.rightTrim} onChange={(e) => setCfg((c) => ({ ...c, rightTrim: e.target.value }))} />
            </Field>
          </div>
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={cfg.minimizeLayoutCount} onCheckedChange={(v) => setCfg((c) => ({ ...c, minimizeLayoutCount: v === true }))} />
            Minimize layout (pattern) count — reuse existing patterns instead of chasing the least waste
          </label>

          <div className="mb-1 mt-3 text-[11px] font-semibold text-muted-foreground">Layout restrictions</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Max parts in layout (0 = none)">
              <Input type="number" min={0} className="h-9" value={cfg.maxPartsInLayout} onChange={(e) => setCfg((c) => ({ ...c, maxPartsInLayout: e.target.value }))} />
            </Field>
            <Field label="Max distinct lengths in layout (0 = none)">
              <Input type="number" min={0} className="h-9" value={cfg.maxDistinctLengthsInLayout} onChange={(e) => setCfg((c) => ({ ...c, maxDistinctLengthsInLayout: e.target.value }))} />
            </Field>
            <Field label="Min length diff among parts (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.minLengthDiffInLayout} onChange={(e) => setCfg((c) => ({ ...c, minLengthDiffInLayout: e.target.value }))} />
            </Field>
          </div>

          <div className="mb-1 mt-3 text-[11px] font-semibold text-muted-foreground">Restricted rest length (mm)</div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From">
              <Input type="number" min={0} className="h-9" value={cfg.restrictedRestFrom} onChange={(e) => setCfg((c) => ({ ...c, restrictedRestFrom: e.target.value }))} />
            </Field>
            <Field label="To">
              <Input type="number" min={0} className="h-9" value={cfg.restrictedRestTo} onChange={(e) => setCfg((c) => ({ ...c, restrictedRestTo: e.target.value }))} />
            </Field>
          </div>

          <div className="mb-1 mt-3 text-[11px] font-semibold text-muted-foreground">Remnants (reusable rests)</div>
          <Field label="Minimal length to keep as a reusable remnant (mm)">
            <Input type="number" min={0} className="h-9" value={cfg.remnantMinLength} onChange={(e) => setCfg((c) => ({ ...c, remnantMinLength: e.target.value }))} />
          </Field>

                </div> },
              ]}
            />
            <div className="sticky bottom-0 z-10 space-y-2 rounded-b-xl border-t border-border bg-muted p-3">
              <Button className="w-full" onClick={start} disabled={!pieces.length}>
                <Ruler /> Optimize cutting
              </Button>
              {status && <p className="text-xs text-destructive" role="alert">{status}</p>}
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <Panel
            title="Nesting preview"
            meta={result ? `${result.layouts.length} layout(s)` : undefined}
            actions={
              <>
                <Button variant="secondary" size="sm" disabled={!canExport} onClick={() => result && resS && download("cut-list.txt", buildCutList(result, resS), "text/plain")}>
                  <Download /> Cut list (.txt)
                </Button>
                <Button variant="secondary" size="sm" disabled={!canExport} onClick={() => result && resS && download("cut-list.csv", buildCutListCsv(result, resS), "text/csv")}>
                  <Download /> Cut list (.csv)
                </Button>
              </>
            }
          >
            {!result || !resS ? (
              <EmptyPanel
                icon={<Ruler />}
                title={pieces.length ? "Ready to cut" : "No parts yet"}
                actions={
                  pieces.length ? (
                    <Button onClick={start}><Ruler /> Optimize cutting</Button>
                  ) : (
                    <Button onClick={() => setRailTab("import")}><Upload /> Import parts</Button>
                  )
                }
              >
                {pieces.length
                  ? "Check the stock lengths, then press Optimize cutting."
                  : "Import a CSV or DXF files, take the bars of a project, or add a part by hand in the Parts tab below. Then add the stock lengths and press Optimize cutting."}
              </EmptyPanel>
            ) : (
              <div className="space-y-4">
                {summary && (
                  <>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                      <KpiTile icon={<Ruler />} label="Bars required" value={summary.bars} hint={`${summary.layouts} layout${summary.layouts === 1 ? "" : "s"}`} />
                      <KpiTile tone="success" icon={<Gauge />} label="Material utilization" value={`${summary.yieldPct.toFixed(1)}%`} progress={summary.yieldPct} />
                      <KpiTile tone="violet" icon={<Recycle />} label="Waste" value={`${Math.max(0, 100 - summary.yieldPct).toFixed(1)}%`} hint="of the total bar length" />
                      <KpiTile icon={<PackageCheck />} label="Parts cut" value={summary.cutParts} />
                    </div>
                    <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 p-3">
                      <Stat label="Layouts" value={String(summary.layouts)} />
                      <Stat label="Total bar length" value={`${summary.totalBarLength.toLocaleString()} mm`} />
                      <Stat label="Total cost" value={summary.totalCost > 0 ? summary.totalCost.toLocaleString() : "—"} />
                    </div>
                  </>
                )}
                <p className="text-xs text-muted-foreground">
                  <Scissors className="mr-1 inline h-3 w-3" />
                  {result.layouts.length} distinct layout(s), {summary?.bars ?? 0} bar(s) total.
                </p>
                {result.layouts.map((l, i) => (
                  <LayoutCard
                    key={i}
                    index={i}
                    bar={l.bars[0]}
                    repeat={l.repeat}
                    S={resS}
                    onResize={(len) => {
                      l.bars.forEach((b) => resizeBar(b, resS, len));
                      bumpV();
                    }}
                    onReset={() => {
                      l.bars.forEach((b) => {
                        b.length = undefined;
                      });
                      bumpV();
                    }}
                  />
                ))}
              </div>
            )}
            {canExport && (
              <div className="mt-4 flex justify-end border-t border-border pt-3">
                <Button onClick={exportReport} disabled={reporting} title="Excel report: bars used, scrap, parts cut, cut list and a picture of every layout">
                  {reporting ? <Loader2 className="animate-spin" /> : <FileSpreadsheet />} Create report (.xlsx)
                </Button>
              </div>
            )}
          {result && (result.skip.length > 0 || result.problems.length > 0) && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <TriangleAlert className="h-4 w-4" /> Problems
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {result.skip.map((m, i) => (
                  <li key={`s${i}`}>{m}</li>
                ))}
                {result.problems.map((m, i) => (
                  <li key={`p${i}`}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          {result && (result.notes?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <Info className="h-4 w-4" /> Notes
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {result.notes!.map((m, i) => (
                  <li key={`n${i}`}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          </Panel>

          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <PaneTabs
              value={mainTab}
              onValueChange={(v) => setMainTab(v as "parts" | "stock")}
              listClassName="px-2 pt-1"
              paneClassName="p-3 sm:p-4"
              tabs={[
                {
                  id: "parts",
                  label: <>Parts &amp; quantities{pieces.length > 0 && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">{pieces.length}</span>}</>,
                  content: (
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const dropped = Array.from(e.dataTransfer.files);
                        const dxf = dropped.filter((f) => /\.dxf$/i.test(f.name));
                        if (dxf.length) handleDxf(dxf);
                        else handleCsv(dropped.filter((f) => /\.csv$/i.test(f.name)));
                      }}
                    >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="sr-only">Parts &amp; quantities</h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground">DXF as</span>
              <TypeSelect value={dxfType} onChange={setDxfType} />
              <select className={selectCls} value={dxfUnits} onChange={(e) => setDxfUnits(e.target.value)} title="Drawing units of the DXF files">
                <option value="auto">Units: auto</option>
                <option value="1">mm</option>
                <option value="10">cm</option>
                <option value="1000">m</option>
                <option value="25.4">inch</option>
              </select>
              <Button asChild variant="secondary" size="sm" disabled={dxfBusy}>
                <label className="cursor-pointer" title="Pick one or many DXF drawings — one part is created per file, with its cut length filled in">
                  {dxfBusy ? <Loader2 className="animate-spin" /> : <Upload />} Import DXF
                  <input
                    type="file"
                    accept=".dxf"
                    multiple
                    hidden
                    onChange={(e) => {
                      const fs = Array.from(e.target.files ?? []);
                      e.target.value = "";
                      handleDxf(fs);
                    }}
                  />
                </label>
              </Button>
              {(pieces.length > 0 || sources.length > 0) && (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmReset(true)}>
                  <Trash2 /> Reset all
                </Button>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1">#</th>
                    <th className="p-1">Name</th>
                    <th className="p-1">Type</th>
                    <th className="p-1">Profile</th>
                    <th className="p-1">Material</th>
                    <th className="p-1">Length (mm)</th>
                    <th className="p-1">Qty</th>
                    <th className="p-1" />
                  </tr>
                </thead>
                <tbody>
                  {pieces.map((p) => (
                    <tr key={p.id} className="border-t border-border">
                      <td className="p-1 font-semibold">#{p.sn}</td>
                      <td className="p-1">{p.name}</td>
                      <td className="p-1">
                        <TypeSelect value={p.partType} onChange={(v) => updatePiece(p.id, { partType: v })} />
                      </td>
                      <td className="p-1">
                        <Input type="text" className="h-8 w-28" value={p.profile} onChange={(e) => updatePiece(p.id, { profile: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <Input type="text" className="h-8 w-24" value={p.material} onChange={(e) => updatePiece(p.id, { material: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <Input type="number" min={0} className="h-8 w-24" value={p.length} onChange={(e) => updatePiece(p.id, { length: Number(e.target.value) || 0 })} />
                      </td>
                      <td className="p-1">
                        <Input type="number" min={0} className="h-8 w-20" value={p.qty} onChange={(e) => updatePiece(p.id, { qty: Math.max(0, Number(e.target.value) | 0) })} />
                      </td>
                      <td className="p-1">
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removePiece(p.id)}>
                          <Trash2 /> Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border bg-secondary/40" onKeyDown={(e) => { if (e.key === "Enter") addPieceRow(); }}>
                    <td className="p-1 font-semibold text-muted-foreground"><Plus className="h-4 w-4" /></td>
                    <td className="p-1">
                      <Input className="h-8 w-28" placeholder="Name" value={pieceForm.name} onChange={(e) => setPieceForm((f) => ({ ...f, name: e.target.value }))} />
                    </td>
                    <td className="p-1">
                      <TypeSelect value={pieceForm.partType} onChange={(v) => setPieceForm((f) => ({ ...f, partType: v }))} />
                    </td>
                    <td className="p-1">
                      <Input className="h-8 w-28" placeholder="e.g. IPE120" value={pieceForm.profile} onChange={(e) => setPieceForm((f) => ({ ...f, profile: e.target.value }))} />
                    </td>
                    <td className="p-1">
                      <Input className="h-8 w-24" placeholder="e.g. S235" value={pieceForm.material} onChange={(e) => setPieceForm((f) => ({ ...f, material: e.target.value }))} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min={0} className="h-8 w-24" placeholder="Length" value={pieceForm.length} onChange={(e) => setPieceForm((f) => ({ ...f, length: e.target.value }))} />
                    </td>
                    <td className="p-1">
                      <Input type="number" min={1} className="h-8 w-20" placeholder="Qty" value={pieceForm.qty} onChange={(e) => setPieceForm((f) => ({ ...f, qty: e.target.value }))} />
                    </td>
                    <td className="p-1">
                      <Button size="sm" onClick={addPieceRow}>
                        <Plus /> Add part
                      </Button>
                    </td>
                  </tr>
                </tfoot>
              </table>
          </div>
          {status && <p className="mt-2 text-xs text-destructive">{status}</p>}
                    </div>
                  ),
                },
                {
                  id: "stock",
                  label: <>Stock (sources){sources.length > 0 && <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${stockMissing ? "bg-amber-100 text-amber-800" : "bg-muted text-muted-foreground"}`}>{stockMissing ? "length needed" : sources.length}</span>}</>,
                  content: (
                    <div>
          {!sources.length ? (
            <p className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-sm text-muted-foreground">No stock yet — it is added automatically when you add or import parts, or add it by hand below.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1">#</th>
                    <th className="p-1">Profile</th>
                    <th className="p-1">Material</th>
                    <th className="p-1">Length (mm) <span className="text-destructive">*</span></th>
                    <th className="p-1">Qty</th>
                    <th className="p-1">Cost/bar</th>
                    <th className="p-1" />
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="p-1 font-semibold">#{s.sn}</td>
                      <td className="p-1">
                        <Input type="text" className="h-8 w-28" value={s.profile} onChange={(e) => updateSource(s.id, { profile: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <Input type="text" className="h-8 w-24" value={s.material} onChange={(e) => updateSource(s.id, { material: e.target.value })} />
                      </td>
                      <td className="p-1">
                        <Input
                          type="number" min={0} placeholder="required"
                          className={`h-8 w-24 ${s.length > 0 ? "" : "border-destructive ring-1 ring-destructive/40"}`}
                          value={s.length > 0 ? s.length : ""}
                          onChange={(e) => updateSource(s.id, { length: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          type="number" min={0} className="h-8 w-20" placeholder="∞"
                          value={s.qty ?? ""}
                          onChange={(e) => updateSource(s.id, { qty: e.target.value === "" ? null : Number(e.target.value) })}
                        />
                      </td>
                      <td className="p-1">
                        <Input type="number" min={0} className="h-8 w-20" value={s.cost} onChange={(e) => updateSource(s.id, { cost: Number(e.target.value) || 0 })} />
                      </td>
                      <td className="p-1">
                        <Button variant="ghost" size="sm" title="Add another stock length for this profile + material" onClick={() => addLengthLike(s)}>
                          <Plus /> Length
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeSource(s.id)}>
                          <Trash2 /> Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 rounded-md border border-dashed border-border p-3">
            <div className="mb-2 text-xs font-medium">Add stock by hand</div>
            <div className="flex flex-wrap items-end gap-2 text-xs">
              <label className="space-y-1">Profile
                <Input type="text" list="src-profiles" className="h-8 w-32" value={srcForm.profile} onChange={(e) => setSrcForm((f) => ({ ...f, profile: e.target.value }))} />
              </label>
              <label className="space-y-1">Material
                <Input type="text" list="src-materials" className="h-8 w-24" value={srcForm.material} onChange={(e) => setSrcForm((f) => ({ ...f, material: e.target.value }))} />
              </label>
              <label className="space-y-1">Lengths (mm)
                <Input
                  type="text" className="h-8 w-64" placeholder="6000, 9000x10, 12000"
                  value={srcForm.lengths}
                  onChange={(e) => setSrcForm((f) => ({ ...f, lengths: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === "Enter") addSourceRows(); }}
                />
              </label>
              <label className="space-y-1">Qty each
                <Input type="number" min={1} className="h-8 w-20" placeholder="∞" value={srcForm.qty} onChange={(e) => setSrcForm((f) => ({ ...f, qty: e.target.value }))} />
              </label>
              <label className="space-y-1">Cost/bar
                <Input type="number" min={0} className="h-8 w-20" value={srcForm.cost} onChange={(e) => setSrcForm((f) => ({ ...f, cost: e.target.value }))} />
              </label>
              <Button size="sm" onClick={addSourceRows}>
                <Plus /> Add lengths
              </Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Type as many lengths as you have, separated by comma, space or new line. Put <code>x</code> and a number after a length for how many bars of it you have
              (<code>9000x10</code>); lengths without it use “Qty each”, blank = unlimited. Profile and material must match the parts to cut.
            </p>
            {srcMsg && <p className="mt-1 text-xs text-destructive">{srcMsg}</p>}
            <datalist id="src-profiles">{[...new Set(pieces.map((p) => p.profile).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
            <datalist id="src-materials">{[...new Set(pieces.map((p) => p.material).filter(Boolean))].map((v) => <option key={v} value={v} />)}</datalist>
          </div>
                    </div>
                  ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Remove all parts and sources?"
        description="This clears every part, every source and the cutting result."
        confirmLabel="Reset all"
        onConfirm={resetAll}
      />
    </div>
  );
}