"use client";
import * as React from "react";
import { Check, Download, FolderInput, Layers, Loader2, RotateCcw, Trash2, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { useTakeoffProject } from "@/features/takeoff/project-context";
import type { TakeoffDrawingRow } from "@/features/takeoff/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  addFileParts,
  buildDxf,
  cancelPick,
  drawSheet,
  makeSettings,
  moveTo,
  parseDXF,
  partColor,
  path,
  problemMessages,
  rotate,
  runOptimize,
  sheetStats,
  startPick,
  transfer,
  type Counters,
  type Group,
  type OptResult,
  type Pt,
  type Sel,
  type Settings,
  type Sheet,
} from "./engine";

const DEFAULT_MSG =
  "SolidWorks: export the flat pattern / drawing to DXF (File → Save As → DXF). .sldprt can't be read directly.";
const selectCls =
  "h-9 w-full rounded-lg border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function PartThumb({ g }: { g: Group }) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  React.useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, 60, 40);
    const k = Math.min(56 / g.w, 36 / g.h);
    c.setTransform(k, 0, 0, -k, 2, 38);
    c.fillStyle = partColor(g);
    c.fill(path(g, 0, 0, 0), "evenodd");
  }, [g]);
  return <canvas ref={ref} width={60} height={40} />;
}

interface SheetCanvasProps {
  sheet: Sheet;
  index: number;
  S: Settings;
  width: number;
  selRef: React.MutableRefObject<Sel | null>;
  version: number;
  /** Index of the sheet the picked-up part is currently over (null = nothing held). */
  heldIdx: number | null;
  onChange: () => void;
}

function SheetCanvas({ sheet, index, S, width, selRef, version, heldIdx, onChange }: SheetCanvasProps) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const k = width / S.W;
  const h = Math.ceil(S.H * k);
  const holdingHere = heldIdx === index;
  const raf = React.useRef(0);
  React.useEffect(() => () => cancelAnimationFrame(raf.current), []);

  React.useEffect(() => {
    const cv = ref.current;
    if (cv) drawSheet(sheet, cv, k, S, selRef.current?.it ?? null, !!selRef.current?.bad);
  }, [sheet, k, h, S, version, selRef]);

  // wheel must be a non-passive native listener so it can preventDefault()
  React.useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      const s = selRef.current;
      if (!s) return;
      e.preventDefault();
      const t = performance.now();
      if (t - (s.lw || 0) < 30) return;
      s.lw = t;
      // free rotation: 5° per notch, hold Shift for 1° fine steps (Shift+wheel may arrive as deltaX)
      const dy = e.deltaY || e.deltaX;
      rotate(s, S, (dy > 0 ? 1 : -1) * (e.shiftKey ? 1 : 5));
      onChange();
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [S, selRef, onChange]);

  const mm = (e: { clientX: number; clientY: number }): Pt => {
    const cv = ref.current as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    const px = ((e.clientX - r.left) * cv.width) / r.width;
    const py = ((e.clientY - r.top) * cv.height) / r.height;
    return [px / k, (cv.height - py) / k];
  };

  return (
    <canvas
      ref={ref}
      width={width}
      height={h}
      className="w-full rounded border border-border bg-card"
      style={{ touchAction: holdingHere ? "none" : "auto", cursor: heldIdx !== null ? "move" : "default" }}
      onDoubleClick={(e) => {
        const cv = ref.current;
        const c = cv?.getContext("2d");
        if (!cv || !c) return;
        const m = mm(e);
        c.setTransform(k, 0, 0, -k, 0, cv.height);
        for (let j = sheet.items.length - 1; j >= 0; j--) {
          const it = sheet.items[j];
          if (c.isPointInPath(path(it.g, it.rot, it.x, it.y), m[0] * k, cv.height - m[1] * k, "evenodd")) {
            selRef.current = startPick(sheet, index, it, m);
            onChange();
            return;
          }
        }
      }}
      onPointerMove={(e) => {
        const s = selRef.current;
        if (!s) return;
        const m = mm(e);
        if (s.idx !== index && !transfer(s, S, sheet, index, m)) return;
        s.pm = m;
        moveTo(s, S, m[0] - s.off[0], m[1] - s.off[1]);
        // redraw at most once per frame so dragging stays smooth
        if (!raf.current) {
          raf.current = requestAnimationFrame(() => {
            raf.current = 0;
            onChange();
          });
        }
      }}
      onClick={(e) => {
        const s = selRef.current;
        if (!s) return;
        if (s.bad) return; // red = overlapping: move to a free spot (or Esc) first
        if (s.idx === index) {
          const m = mm(e);
          moveTo(s, S, m[0] - s.off[0], m[1] - s.off[1]);
        }
        selRef.current = null;
        onChange();
      }}
    />
  );
}

// mm-per-unit for the unit label the server-side DXF parser detected.
const UNIT_SCALE: Record<string, number> = { in: 25.4, ft: 304.8, mm: 1, cm: 10, m: 1000, "µm": 0.001, dm: 100 };

export function NestBoost() {
  const { projectId, nestingQueue, clearNestingQueue } = useTakeoffProject();
  const [importing, setImporting] = React.useState(false);
  // Takeoff part ids already imported into this session, so pressing
  // "Import" twice never doubles the quantities.
  const importedIds = React.useRef<Set<string>>(new Set());
  const [groups, setGroups] = React.useState<Group[]>([]);
  const groupsRef = React.useRef<Group[]>([]);
  const counters = React.useRef<Counters>({ id: 0, sn: 0 });
  const [msg, setMsg] = React.useState(DEFAULT_MSG);
  const [units, setUnits] = React.useState("1");
  const [cfg, setCfg] = React.useState({
    W: "6000", H: "1500", mg: "5", gp: "5", cell: "5", ro: "2", tm: "20", pair: true, common: false,
  });
  const [running, setRunning] = React.useState(false);
  const [status, setStatus] = React.useState("");
  const [result, setResult] = React.useState<OptResult | null>(null);
  const [resS, setResS] = React.useState<Settings | null>(null);
  const [version, setVersion] = React.useState(0);
  const [confirmReset, setConfirmReset] = React.useState(false);
  // Multi-select in "Parts & quantities" + the "Are you sure?" for removals.
  const [checked, setChecked] = React.useState<Set<number>>(new Set());
  const [pendingRemove, setPendingRemove] = React.useState<number[] | null>(null);

  const selRef = React.useRef<Sel | null>(null);
  const runRef = React.useRef(0);
  const stopRef = React.useRef(false);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(600);
  // What is currently picked up — mirrored into state so the UI can render it
  // (the live selection itself stays in selRef because it is mutated per mouse move).
  const [held, setHeld] = React.useState<{ idx: number; sn: number; name: string; bad: boolean } | null>(null);
  const bump = React.useCallback(() => {
    setVersion((v) => v + 1);
    const s = selRef.current;
    const next = s ? { idx: s.idx, sn: s.it.g.sn, name: s.it.g.name, bad: !!s.bad } : null;
    // keep the same object when nothing changed so mouse moves don't re-render the whole page
    setHeld((p) => (p && next && p.idx === next.idx && p.sn === next.sn && p.bad === next.bad ? p : next));
  }, []);

  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const upd = () => setWidth(Math.max(300, el.clientWidth));
    upd();
    const ro = new ResizeObserver(upd);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const setG = (g: Group[]) => {
    groupsRef.current = g;
    setGroups(g);
  };

  /** Drops the nesting result (and stops a running optimisation). */
  const clearResults = () => {
    runRef.current++;
    stopRef.current = true;
    selRef.current = null;
    setResult(null);
    setResS(null);
    setRunning(false);
    setStatus("");
    bump();
  };

  async function handleFiles(files: File[]) {
    if (!files.length) return;
    let gs = groupsRef.current;
    let text = "";
    for (const f of files) {
      const r = parseDXF(await f.text());
      const added = addFileParts(gs, r.loops, f.name, +units, counters.current);
      gs = added.groups;
      text +=
        `${f.name}: ${r.loops.length} contours → ${added.count} part(s)` +
        (r.skip.length ? ` (unsupported/approximated: ${r.skip.join(", ")})` : "") +
        "\n";
    }
    setG(gs);
    setMsg(text);
  }

  /**
   * Pulls the DXF + quantity + thickness of parts straight from Standard
   * Calculations. `onlyIds` = parts sent one by one; omitted = every part in
   * the project that has a valid DXF.
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

        let gs = groupsRef.current;
        let text = "";
        let ok = 0;
        const skipped: string[] = [];

        for (const d of drawings) {
          for (const part of d.parts) {
            if (wanted && !wanted.has(part.id)) continue;
            const label = `${d.drawingNumber} #${part.itemNo} ${part.description}`;
            if (importedIds.current.has(part.id)) { skipped.push(`${label}: already imported`); continue; }
            if (!part.dxf) { skipped.push(`${label}: no DXF`); continue; }
            if (!part.dxf.valid) { skipped.push(`${label}: DXF invalid`); continue; }
            if (part.qty <= 0) { skipped.push(`${label}: qty is 0`); continue; }
            const r = await fetch(`/api/takeoff/parts/${part.id}/dxf`);
            if (!r.ok) { skipped.push(`${label}: could not read file`); continue; }
            const parsed = parseDXF(await r.text());
            const scale = UNIT_SCALE[part.dxf.unitsDetected ?? "mm"] ?? +units;
            const added = addFileParts(gs, parsed.loops, label, scale, counters.current, {
              th: part.thicknessMm ?? 0,
              qty: part.qty,
            });
            gs = added.groups;
            importedIds.current.add(part.id);
            ok++;
            text += `${label}: ${part.qty} pcs, ${part.thicknessMm ?? "?"} mm → ${added.count} contour(s)\n`;
          }
        }
        setG(gs);
        if (ok) clearResults();
        setMsg((text + (skipped.length ? `\nSkipped:\n${skipped.join("\n")}` : "")).trim() || "Nothing to import.");
        if (ok) toast.success(`Imported ${ok} part(s) from Standard Calculations`);
        else toast.warning("No parts were imported");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Import failed");
      } finally {
        setImporting(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, units],
  );

  // Parts sent one-by-one from the Standard Calculations tab.
  React.useEffect(() => {
    if (!nestingQueue.length || !projectId) return;
    const ids = nestingQueue;
    clearNestingQueue();
    importFromProject(ids);
  }, [nestingQueue, projectId, clearNestingQueue, importFromProject]);

  const updateGroup = (id: number, patch: Partial<Group>) =>
    setG(groupsRef.current.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const removeParts = (ids: number[]) => {
    const drop = new Set(ids);
    const gone = groupsRef.current.filter((x) => drop.has(x.id));
    setG(groupsRef.current.filter((x) => !drop.has(x.id)));
    setChecked(new Set());
    clearResults();
    setMsg(
      gone.length === 1
        ? `Part #${gone[0].sn} (${gone[0].name}) removed. Press Optimize to re-nest.`
        : `${gone.length} parts removed. Press Optimize to re-nest.`,
    );
  };

  const resetAll = () => {
    setG([]);
    setChecked(new Set());
    importedIds.current = new Set();
    counters.current = { id: 0, sn: 0 };
    clearResults();
    setMsg(DEFAULT_MSG);
    setConfirmReset(false);
  };

  async function start() {
    const v = {
      W: Number(cfg.W), H: Number(cfg.H), mg: Number(cfg.mg), gp: Number(cfg.gp),
      cell: Number(cfg.cell), ro: Number(cfg.ro),
    };
    if (!(v.W > 0 && v.H > 0 && v.cell > 0 && v.mg >= 0 && v.gp >= 0)) {
      setStatus("Check the sheet settings (length, width, margin, spacing).");
      return;
    }
    const S = makeSettings(v);
    const my = ++runRef.current;
    stopRef.current = false;
    selRef.current = null;
    bump();
    setRunning(true);
    setStatus("");
    const res = await runOptimize(groupsRef.current, {
      S,
      pair: cfg.pair,
      common: cfg.common,
      timeSec: Number(cfg.tm) || 20,
      shouldStop: () => stopRef.current || my !== runRef.current,
      onBest: (r) => {
        if (my !== runRef.current) return;
        setResS(S);
        setResult(r);
      },
      onStatus: (t) => {
        if (my === runRef.current) setStatus(t);
      },
    });
    if (my !== runRef.current) return;
    if (!res) setStatus("Nothing to nest — all quantities are 0.");
    else {
      setResS(S);
      setResult(res);
    }
    setRunning(false);
  }

  function exportDxf() {
    if (!result || !resS) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buildDxf(result.sheets, resS)], { type: "application/dxf" }));
    a.download = "nested.dxf";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // keyboard while a part is picked up
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sel = selRef.current;
      if (!sel || !resS) return;
      if (e.key === "Escape") {
        cancelPick(sel);
        selRef.current = null;
        bump();
        return;
      }
      const d = e.shiftKey ? 10 : 1;
      const mv: Record<string, Pt> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] };
      const m = mv[e.key];
      if (m) {
        e.preventDefault();
        moveTo(sel, resS, sel.it.x + m[0], sel.it.y + m[1]);
        bump();
      } else if (e.key === "r" || e.key === "R") {
        rotate(sel, resS, 90);
        bump();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resS, bump]);

  const problems = result && resS ? problemMessages(result, resS) : [];
  const canExport = !!result && !running && result.sheets.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1. Import</h3>
          <label
            className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed border-border p-5 text-center text-sm text-muted-foreground hover:bg-secondary"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleFiles(Array.from(e.dataTransfer.files).filter((f) => /\.dxf$/i.test(f.name)));
            }}
          >
            <Upload className="h-5 w-5" />
            Drop DXF files here or click
            <input
              type="file"
              accept=".dxf"
              multiple
              hidden
              onChange={(e) => {
                const fs = Array.from(e.target.files ?? []);
                e.target.value = ""; // allow re-importing the same file after a reset
                handleFiles(fs);
              }}
            />
          </label>
          <Button
            variant="secondary"
            className="mt-2 w-full"
            disabled={!projectId || importing}
            onClick={() => importFromProject()}
            title="Import every part of the selected project that has a valid DXF, with its quantity and thickness"
          >
            {importing ? <Loader2 className="animate-spin" /> : <FolderInput />} Import all from Standard Calculations
          </Button>
          {!projectId && <p className="mt-1 text-xs text-muted-foreground">Select a project above to enable this.</p>}
          <div className="mt-2">
            <Field label="Drawing units (manual uploads only)">
              <select className={selectCls} value={units} onChange={(e) => setUnits(e.target.value)}>
                <option value="1">mm</option>
                <option value="25.4">inch</option>
              </select>
            </Field>
          </div>
          <p className="mt-2 whitespace-pre-line text-xs text-muted-foreground">{msg}</p>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">2. Sheet &amp; settings</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Sheet length (mm)">
              <Input type="number" value={cfg.W} onChange={(e) => setCfg({ ...cfg, W: e.target.value })} />
            </Field>
            <Field label="Sheet width (mm)">
              <Input type="number" value={cfg.H} onChange={(e) => setCfg({ ...cfg, H: e.target.value })} />
            </Field>
            <Field label="Edge margin (mm)">
              <Input type="number" value={cfg.mg} onChange={(e) => setCfg({ ...cfg, mg: e.target.value })} />
            </Field>
            <Field label="Part spacing (mm)">
              <Input type="number" value={cfg.gp} onChange={(e) => setCfg({ ...cfg, gp: e.target.value })} />
            </Field>
            {/* <Field label="Grid cell (mm) – smaller = tighter, slower">
              <select className={selectCls} value={cfg.cell} onChange={(e) => setCfg({ ...cfg, cell: e.target.value })}>
                <option>3</option>
                <option>5</option>
                <option>8</option>
              </select>
            </Field> */}
            <Field label="Rotation">
              <select className={selectCls} value={cfg.ro} onChange={(e) => setCfg({ ...cfg, ro: e.target.value })}>
                <option value="0">None</option>
                <option value="1">0° / 180°</option>
                <option value="2">90° steps</option>
                <option value="3">45° steps</option>
                <option value="4">15° steps (slower)</option>
              </select>
            </Field>
            <Field label="Optimize time (s)">
              <Input type="number" value={cfg.tm} onChange={(e) => setCfg({ ...cfg, tm: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-xs text-muted-foreground">
              <Checkbox checked={cfg.pair} onCheckedChange={(v) => setCfg({ ...cfg, pair: v === true })} />
              Auto-pair triangles
            </label>
            <label className="col-span-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={cfg.common} onCheckedChange={(v) => setCfg({ ...cfg, common: v === true })} />
              Common cut line (no gap inside pair)
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={start} disabled={running || !groups.length}>
              <Layers /> Optimize nest
            </Button>
            <Button variant="secondary" onClick={() => (stopRef.current = true)} disabled={!running}>
              Stop
            </Button>
            <Button variant="secondary" onClick={exportDxf} disabled={!canExport}>
              <Download /> Export DXF
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{status}</p>
        </Card>
      </div>

      <div className="min-w-0 space-y-4">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parts &amp; quantities</h3>
            <div className="flex items-center gap-2">
            {checked.size > 0 && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setPendingRemove([...checked])}>
                <Trash2 /> Remove selected ({checked.size})
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={!groups.length}
              onClick={() => setConfirmReset(true)}
            >
              <Trash2 /> Reset all
            </Button>
            </div>
          </div>
          {!groups.length ? (
            <p className="text-sm text-muted-foreground">No parts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1">
                      <Checkbox
                        aria-label="Select all parts"
                        checked={
                          groups.length > 0 && groups.every((g) => checked.has(g.id))
                            ? true
                            : checked.size > 0 ? "indeterminate" : false
                        }
                        onCheckedChange={(v) => setChecked(v === true ? new Set(groups.map((g) => g.id)) : new Set())}
                      />
                    </th>
                    <th className="p-1">#</th>
                    <th className="p-1" />
                    <th className="p-1">File</th>
                    <th className="p-1">Size (mm)</th>
                    <th className="p-1">Area</th>
                    <th className="p-1">Holes</th>
                    <th className="p-1">Thick (mm)</th>
                    <th className="p-1">Qty</th>
                    <th className="p-1" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.id} className={`border-t border-border ${checked.has(g.id) ? "bg-primary/5" : ""}`}>
                      <td className="p-1">
                        <Checkbox
                          aria-label={`Select part #${g.sn}`}
                          checked={checked.has(g.id)}
                          onCheckedChange={(v) =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(g.id); else next.delete(g.id);
                              return next;
                            })
                          }
                        />
                      </td>
                      <td className="p-1 font-semibold">#{g.sn}</td>
                      <td className="p-1"><PartThumb g={g} /></td>
                      <td className="p-1">{g.name}</td>
                      <td className="p-1 whitespace-nowrap">{g.w.toFixed(1)} × {g.h.toFixed(1)}</td>
                      <td className="p-1">{Math.round(g.area)}</td>
                      <td className="p-1">{g.holes.length}</td>
                      <td className="p-1">
                        <Input
                          type="number" min={0} step="any" placeholder="mm" className="h-8 w-20"
                          value={g.th || ""}
                          onChange={(e) => updateGroup(g.id, { th: Number(e.target.value) || 0 })}
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          type="number" min={0} className="h-8 w-20" value={g.qty}
                          onChange={(e) => updateGroup(g.id, { qty: Math.max(0, Number(e.target.value) | 0) })}
                        />
                      </td>
                      <td className="p-1">
                        <Button variant="ghost" size="sm" className="text-destructive" title="Remove this part" onClick={() => setPendingRemove([g.id])}>
                          <Trash2 /> Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Nesting result</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            Double-click a part to pick it up: it follows the mouse (move it onto another sheet of the same thickness to
            transfer it), scroll the wheel to rotate freely (5° per notch, hold Shift for 1°; R = 90°), click to place, Esc to cancel. While moving, it can&apos;t overlap other parts,
            break the spacing, or enter the margin (it stays at the last allowed position). Rotation is never blocked: if there&apos;s no room the part
            turns anyway and goes red — drag it to a free spot to place it.
          </p>
          {held && (
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => { if (resS && selRef.current) { rotate(selRef.current, resS, 90); bump(); } }}>
                <RotateCcw /> Rotate 90°
              </Button>
              <Button variant="secondary" size="sm" disabled={held.bad} onClick={() => { selRef.current = null; bump(); }}>
                <Check /> Done
              </Button>
              <span className="text-xs text-muted-foreground">
                {held.bad
                  ? `Part #${held.sn} overlaps something (red) — move it to a free spot to place it, or press Esc to cancel`
                  : `Holding: Part #${held.sn} (${held.name}) — move the mouse, scroll to rotate, click to place`}
              </span>
            </div>
          )}
          <div ref={boxRef} className="space-y-4">
            {!result || !resS ? (
              <p className="text-sm text-muted-foreground">Import parts, then press Optimize.</p>
            ) : (
              result.sheets.map((sh, i) => {
                const st = sheetStats(sh, resS);
                return (
                  <div key={i}>
                    <div className="mb-1 text-xs text-muted-foreground">
                      <b className="text-foreground">Sheet {i + 1}</b> — {sh.th ? `${sh.th} mm plate • ` : ""}
                      {st.parts} parts • used length {st.usedLength} mm • utilization {st.utilization.toFixed(1)}%
                    </div>
                    <SheetCanvas sheet={sh} index={i} S={resS} width={width} selRef={selRef} version={version} heldIdx={held ? held.idx : null} onChange={bump} />
                  </div>
                );
              })
            )}
          </div>
          {problems.length > 0 && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <TriangleAlert className="h-4 w-4" /> Nesting problems
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {problems.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={!!pendingRemove}
        onOpenChange={(v) => !v && setPendingRemove(null)}
        title={
          pendingRemove && pendingRemove.length > 1
            ? `Are you sure you want to remove ${pendingRemove.length} parts?`
            : "Are you sure you want to remove this part?"
        }
        description="The nesting result will be cleared and you'll need to press Optimize again."
        confirmLabel="Remove"
        onConfirm={() => {
          if (pendingRemove) removeParts(pendingRemove);
          setPendingRemove(null);
        }}
      />

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Reset all parts?"
        description="This removes every imported part and the current nesting result."
        confirmLabel="Reset all"
        onConfirm={resetAll}
      />
    </div>
  );
}