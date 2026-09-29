"use client";
import * as React from "react";
import { Download, Package, Plus, Ruler, Scissors, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  addPiece,
  addSource,
  barStats,
  buildCutList,
  buildCutListCsv,
  minBarLength,
  overallStats,
  resizeBar,
  runOptimize1D,
  type Bar,
  type Counters1D,
  type Piece1D,
  type Result1D,
  type Settings1D,
  type Source1D,
} from "./engine";

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

/** Stable colour per part serial number. */
function pieceColor(sn: number): string {
  const hues = [210, 25, 150, 280, 50, 190, 340, 100];
  return `hsl(${hues[sn % hues.length]} 65% 62%)`;
}

function BarStrip({ b, S }: { b: Bar; S: Settings1D }) {
  const L = b.length ?? b.sourceLength;
  const st = barStats(b, S);
  return (
    <div className="relative h-9 w-full overflow-hidden rounded border border-border bg-secondary">
      <div className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${(100 * S.leftTrim) / L}%` }} />
      <div className="absolute inset-y-0 right-0 bg-muted" style={{ width: `${(100 * (S.rightTrim + S.gripping)) / L}%` }} />
      {b.cuts.map((c, i) => (
        <div
          key={i}
          title={`#${c.piece.sn} ${c.piece.name} — ${Math.round(c.piece.length)} mm`}
          className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-white"
          style={{
            left: `${(100 * (S.leftTrim + c.pos)) / L}%`,
            width: `${(100 * c.piece.length) / L}%`,
            background: pieceColor(c.piece.sn),
            borderLeft: "1px solid rgba(255,255,255,.6)",
          }}
        >
          #{c.piece.sn}
        </div>
      ))}
      {st.isRemnant && st.rest > 0 && (
        <div
          className="absolute inset-y-0 flex items-center justify-center bg-emerald-500/30 text-[9px] font-semibold text-emerald-900"
          style={{ left: `${(100 * (S.leftTrim + st.usedLength)) / L}%`, width: `${(100 * st.rest) / L}%` }}
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
  return (
    <div>
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
  const pieceCounters = React.useRef<Counters1D>({ id: 0, sn: 0 });
  const sourceCounters = React.useRef<Counters1D>({ id: 100000, sn: 0 });

  const [pieceForm, setPieceForm] = React.useState({ name: "", profile: "", material: "", length: "", qty: "1" });
  const [sourceForm, setSourceForm] = React.useState({ profile: "", material: "", length: "6000", qty: "", cost: "", description: "" });

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
  const [, bumpV] = React.useReducer((v: number) => v + 1, 0);

  const addPieceRow = () => {
    const length = Number(pieceForm.length);
    if (!(length > 0)) {
      setStatus("Enter a cut length in mm for the part.");
      return;
    }
    setPieces((prev) =>
      addPiece(prev, { name: pieceForm.name, profile: pieceForm.profile, material: pieceForm.material, length, qty: Number(pieceForm.qty) || 1 }, pieceCounters.current),
    );
    setPieceForm((f) => ({ ...f, name: "", length: "", qty: "1" }));
    setStatus("");
  };

  const addSourceRow = () => {
    const length = Number(sourceForm.length);
    if (!(length > 0)) {
      setStatus("Enter a stock bar length in mm for the source.");
      return;
    }
    setSources((prev) =>
      addSource(
        prev,
        {
          profile: sourceForm.profile,
          material: sourceForm.material,
          length,
          qty: sourceForm.qty.trim() === "" ? null : Number(sourceForm.qty),
          cost: Number(sourceForm.cost) || 0,
          description: sourceForm.description,
        },
        sourceCounters.current,
      ),
    );
    setSourceForm((f) => ({ ...f, length: "6000", qty: "", cost: "", description: "" }));
    setStatus("");
  };

  const updatePiece = (id: number, patch: Partial<Piece1D>) => setPieces((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const removePiece = (id: number) => {
    setPieces((prev) => prev.filter((p) => p.id !== id));
    setResult(null);
  };
  const updateSource = (id: number, patch: Partial<Source1D>) => setSources((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeSource = (id: number) => {
    setSources((prev) => prev.filter((s) => s.id !== id));
    setResult(null);
  };

  const resetAll = () => {
    setPieces([]);
    setSources([]);
    pieceCounters.current = { id: 0, sn: 0 };
    sourceCounters.current = { id: 100000, sn: 0 };
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
  const summary = result && resS ? overallStats(result, sources) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,420px)_1fr]">
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1. Parts</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name">
              <Input className="h-9" value={pieceForm.name} onChange={(e) => setPieceForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Column leg" />
            </Field>
            <Field label="Profile / section">
              <Input className="h-9" value={pieceForm.profile} onChange={(e) => setPieceForm((f) => ({ ...f, profile: e.target.value }))} placeholder='e.g. IPE120' />
            </Field>
            <Field label="Material">
              <Input className="h-9" value={pieceForm.material} onChange={(e) => setPieceForm((f) => ({ ...f, material: e.target.value }))} placeholder="e.g. S235" />
            </Field>
            <Field label="Length (mm)">
              <Input type="number" min={0} className="h-9" value={pieceForm.length} onChange={(e) => setPieceForm((f) => ({ ...f, length: e.target.value }))} />
            </Field>
            <Field label="Qty">
              <Input type="number" min={1} className="h-9" value={pieceForm.qty} onChange={(e) => setPieceForm((f) => ({ ...f, qty: e.target.value }))} />
            </Field>
            <div className="flex items-end">
              <Button className="h-9 w-full" onClick={addPieceRow}>
                <Plus /> Add part
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">2. Sources (stock on hand)</h3>
          <p className="mb-2 text-xs text-muted-foreground">
            The stock bar lengths available to cut from. A profile + material can have several sources (e.g. 12,000 mm and 6,000
            mm bars). Leave Qty empty for unlimited stock. Profile/material must match the parts exactly to be used for them.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Profile / section">
              <Input className="h-9" value={sourceForm.profile} onChange={(e) => setSourceForm((f) => ({ ...f, profile: e.target.value }))} placeholder='e.g. IPE120' />
            </Field>
            <Field label="Material">
              <Input className="h-9" value={sourceForm.material} onChange={(e) => setSourceForm((f) => ({ ...f, material: e.target.value }))} placeholder="e.g. S235" />
            </Field>
            <Field label="Bar length (mm)">
              <Input type="number" min={0} className="h-9" value={sourceForm.length} onChange={(e) => setSourceForm((f) => ({ ...f, length: e.target.value }))} />
            </Field>
            <Field label="Qty (blank = unlimited)">
              <Input type="number" min={0} className="h-9" value={sourceForm.qty} onChange={(e) => setSourceForm((f) => ({ ...f, qty: e.target.value }))} />
            </Field>
            <Field label="Cost / bar (optional)">
              <Input type="number" min={0} className="h-9" value={sourceForm.cost} onChange={(e) => setSourceForm((f) => ({ ...f, cost: e.target.value }))} />
            </Field>
            <div className="flex items-end">
              <Button className="h-9 w-full" variant="secondary" onClick={addSourceRow}>
                <Package /> Add source
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">3. Settings</h3>
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

          <Button className="mt-3 w-full" onClick={start} disabled={!pieces.length}>
            <Ruler /> Optimize cutting
          </Button>
          {status && <p className="mt-2 text-xs text-destructive">{status}</p>}
        </Card>
      </div>

      <div className="space-y-4">
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Parts &amp; quantities</h3>
            {(pieces.length > 0 || sources.length > 0) && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmReset(true)}>
                <Trash2 /> Reset all
              </Button>
            )}
          </div>
          {!pieces.length ? (
            <p className="text-sm text-muted-foreground">No parts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1">#</th>
                    <th className="p-1">Name</th>
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
              </table>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sources</h3>
          {!sources.length ? (
            <p className="text-sm text-muted-foreground">No sources yet — add at least one stock length per profile/material.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1">#</th>
                    <th className="p-1">Profile</th>
                    <th className="p-1">Material</th>
                    <th className="p-1">Length (mm)</th>
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
                        <Input type="number" min={0} className="h-8 w-24" value={s.length} onChange={(e) => updateSource(s.id, { length: Number(e.target.value) || 0 })} />
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
        </Card>

        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Results</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={!canExport} onClick={() => result && resS && download("cut-list.txt", buildCutList(result, resS), "text/plain")}>
                <Download /> Cut list (.txt)
              </Button>
              <Button variant="secondary" size="sm" disabled={!canExport} onClick={() => result && resS && download("cut-list.csv", buildCutListCsv(result, resS), "text/csv")}>
                <Download /> Cut list (.csv)
              </Button>
            </div>
          </div>
          {!result || !resS ? (
            <p className="text-sm text-muted-foreground">Add parts and sources, then press Optimize cutting.</p>
          ) : (
            <div className="space-y-4">
              {summary && (
                <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-secondary/40 p-3 sm:grid-cols-6">
                  <Stat label="Yield" value={`${summary.yieldPct.toFixed(1)}%`} />
                  <Stat label="Bars used" value={String(summary.bars)} />
                  <Stat label="Layouts" value={String(summary.layouts)} />
                  <Stat label="Cut parts" value={String(summary.cutParts)} />
                  <Stat label="Total bar length" value={`${summary.totalBarLength.toLocaleString()} mm`} />
                  <Stat label="Total cost" value={summary.totalCost > 0 ? summary.totalCost.toLocaleString() : "—"} />
                </div>
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
        </Card>
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