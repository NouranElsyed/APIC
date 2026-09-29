"use client";
import * as React from "react";
import { Download, Plus, Ruler, Scissors, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  addPiece,
  barStats,
  buildCutList,
  buildCutListCsv,
  minBarLength,
  resizeBar,
  runOptimize1D,
  usableBarLength,
  type Bar,
  type Counters1D,
  type Piece1D,
  type Result1D,
  type Settings1D,
} from "./engine";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Stable colour per part serial number, same palette family as the 2D tool. */
function pieceColor(sn: number): string {
  const hues = [210, 25, 150, 280, 50, 190, 340, 100];
  const h = hues[sn % hues.length];
  return `hsl(${h} 65% 62%)`;
}

function BarRow({ b, S, onResize, onReset }: { b: Bar; S: Settings1D; onResize: (l: number) => void; onReset: () => void }) {
  const L = b.length ?? S.barLength;
  const st = barStats(b, S);
  const trimmed = b.length !== undefined;
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          <b className="text-foreground">
            {b.profile || "profile ?"} {b.material ? `— ${b.material}` : ""}
          </b>{" "}
          — {st.pieces} pcs • scrap {st.scrap} mm • utilization {st.utilization.toFixed(1)}%
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
        <Button variant="ghost" size="sm" className="h-7" title="Shrink to just fit its cuts, to cut less material / less scrap" onClick={() => onResize(minBarLength(b, S))}>
          Fit to cuts
        </Button>
        {trimmed && (
          <Button variant="ghost" size="sm" className="h-7" onClick={onReset}>
            Reset to full bar
          </Button>
        )}
      </div>
      <div className="relative h-9 w-full overflow-hidden rounded border border-border bg-secondary">
        {/* end-trim zones */}
        <div className="absolute inset-y-0 left-0 bg-muted" style={{ width: `${(100 * S.endTrim) / L}%` }} />
        <div className="absolute inset-y-0 right-0 bg-muted" style={{ width: `${(100 * S.endTrim) / L}%` }} />
        {b.cuts.map((c, i) => (
          <div
            key={i}
            title={`#${c.piece.sn} ${c.piece.name} — ${Math.round(c.piece.length)} mm`}
            className="absolute inset-y-0 flex items-center justify-center overflow-hidden text-[10px] font-semibold text-white"
            style={{
              left: `${(100 * (S.endTrim + c.pos)) / L}%`,
              width: `${(100 * c.piece.length) / L}%`,
              background: pieceColor(c.piece.sn),
              borderLeft: "1px solid rgba(255,255,255,.6)",
            }}
          >
            #{c.piece.sn}
          </div>
        ))}
      </div>
    </div>
  );
}

export function NestBoost1D() {
  const [pieces, setPieces] = React.useState<Piece1D[]>([]);
  const counters = React.useRef<Counters1D>({ id: 0, sn: 0 });
  const [form, setForm] = React.useState({ name: "", profile: "", material: "", length: "", qty: "1" });

  const [cfg, setCfg] = React.useState({ barLength: "6000", kerf: "3", endTrim: "10" });
  const [result, setResult] = React.useState<Result1D | null>(null);
  const [resS, setResS] = React.useState<Settings1D | null>(null);
  const [status, setStatus] = React.useState("");
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [, bumpV] = React.useReducer((v: number) => v + 1, 0);

  const addFromForm = () => {
    const length = Number(form.length);
    if (!(length > 0)) {
      setStatus("Enter a cut length in mm.");
      return;
    }
    setPieces((prev) =>
      addPiece(
        prev,
        { name: form.name, profile: form.profile, material: form.material, length, qty: Number(form.qty) || 1 },
        counters.current,
      ),
    );
    setForm((f) => ({ ...f, name: "", length: "", qty: "1" }));
    setStatus("");
  };

  const updatePiece = (id: number, patch: Partial<Piece1D>) =>
    setPieces((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const removePiece = (id: number) => {
    setPieces((prev) => prev.filter((p) => p.id !== id));
    setResult(null);
  };

  const resetAll = () => {
    setPieces([]);
    counters.current = { id: 0, sn: 0 };
    setResult(null);
    setResS(null);
    setStatus("");
    setConfirmReset(false);
  };

  const start = () => {
    const S: Settings1D = {
      barLength: Number(cfg.barLength),
      kerf: Number(cfg.kerf),
      endTrim: Number(cfg.endTrim),
    };
    if (!(S.barLength > 0) || S.kerf < 0 || S.endTrim < 0 || usableBarLength(S) <= 0) {
      setStatus("Check the bar length, kerf and end trim.");
      return;
    }
    if (!pieces.some((p) => p.qty > 0)) {
      setStatus("Add at least one part with a quantity above 0.");
      return;
    }
    const res = runOptimize1D(pieces, S);
    setResS(S);
    setResult(res);
    setStatus("");
  };

  function exportCsv() {
    if (!result || !resS) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buildCutListCsv(result.bars, resS)], { type: "text/csv" }));
    a.download = "cut-list.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function exportTxt() {
    if (!result || !resS) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buildCutList(result.bars, resS)], { type: "text/plain" }));
    a.download = "cut-list.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const canExport = !!result && result.bars.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
      <div className="space-y-4">
        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">1. Add parts</h3>
          <p className="mb-3 text-xs text-muted-foreground">
            For hot-rolled / linear stock — bars, pipes, angles, channels, plate strips. Nesting only cuts one bar
            from parts of the same profile and material.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Name">
              <Input className="h-9" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Column leg" />
            </Field>
            <Field label="Profile / section">
              <Input className="h-9" value={form.profile} onChange={(e) => setForm((f) => ({ ...f, profile: e.target.value }))} placeholder='e.g. IPE200, L40x40x4, PIPE 2"' />
            </Field>
            <Field label="Material">
              <Input className="h-9" value={form.material} onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))} placeholder="e.g. S235" />
            </Field>
            <Field label="Length (mm)">
              <Input type="number" min={0} className="h-9" value={form.length} onChange={(e) => setForm((f) => ({ ...f, length: e.target.value }))} />
            </Field>
            <Field label="Qty">
              <Input type="number" min={1} className="h-9" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
            </Field>
            <div className="flex items-end">
              <Button className="h-9 w-full" onClick={addFromForm}>
                <Plus /> Add part
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">2. Bar &amp; settings</h3>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Stock bar length (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.barLength} onChange={(e) => setCfg((c) => ({ ...c, barLength: e.target.value }))} />
            </Field>
            <Field label="Kerf / cut width (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.kerf} onChange={(e) => setCfg((c) => ({ ...c, kerf: e.target.value }))} />
            </Field>
            <Field label="End trim, each side (mm)">
              <Input type="number" min={0} className="h-9" value={cfg.endTrim} onChange={(e) => setCfg((c) => ({ ...c, endTrim: e.target.value }))} />
            </Field>
          </div>
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
            {pieces.length > 0 && (
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
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cutting result</h3>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={!canExport} onClick={exportTxt}>
                <Download /> Cut list (.txt)
              </Button>
              <Button variant="secondary" size="sm" disabled={!canExport} onClick={exportCsv}>
                <Download /> Cut list (.csv)
              </Button>
            </div>
          </div>
          {!result || !resS ? (
            <p className="text-sm text-muted-foreground">Add parts, then press Optimize cutting.</p>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                <Scissors className="mr-1 inline h-3 w-3" />
                {result.bars.length} bar(s) used.
              </p>
              {result.bars.map((b, i) => (
                <BarRow
                  key={i}
                  b={b}
                  S={resS}
                  onResize={(l) => {
                    resizeBar(b, resS, l);
                    bumpV();
                  }}
                  onReset={() => {
                    b.length = undefined;
                    bumpV();
                  }}
                />
              ))}
            </div>
          )}
          {result && result.skip.length > 0 && (
            <div className="mt-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
              <div className="mb-1 flex items-center gap-2 font-semibold">
                <TriangleAlert className="h-4 w-4" /> Parts that could not be cut
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs">
                {result.skip.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Remove all parts?"
        description="This clears every part and the cutting result."
        confirmLabel="Reset all"
        onConfirm={resetAll}
      />
    </div>
  );
}