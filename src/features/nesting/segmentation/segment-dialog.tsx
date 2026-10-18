"use client";
/**
 * Segmentation dialog (Phase 4: settings + read-only preview).
 *
 * Nothing here changes the nest: the part is only read, layouts are generated on a draft, and
 * closing the dialog discards everything. Creating the segments as parts is a later phase.
 */
import * as React from "react";
import { Layers, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { makeSettings, type Group } from "../nest-boost/engine";
import { classifyFit } from "./fit";
import { candidateFacts, defaultForm, parseForm, type NestCtx, type SegForm } from "./form";
import { regionInteriorPoint } from "./geometry";
import { groupToRegion } from "./group-region";
import { buildPlan, generateCandidates, type Candidate, type Plan } from "./planner";
import { regionPath, seamLines, segmentFill, segmentStroke, svgViewBox } from "./preview-path";
import type { Region } from "./types";

const selectCls =
  "h-9 w-full rounded-lg border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-muted-foreground">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

const mm = (v: number) => (Math.round(v * 10) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 });

/* ------------------------------------------------------------------ */
/* Preview                                                             */
/* ------------------------------------------------------------------ */

/** Exact-geometry drawing of a plan: original outline, numbered segments, seams, overlap zones. */
export function PlanPreview({ region, plan }: { region: Region; plan: Plan }) {
  const { box, size } = React.useMemo(() => svgViewBox(region), [region]);
  const labels = React.useMemo(() => plan.segments.map((s) => ({ id: s.id, p: regionInteriorPoint(s.finished) })), [plan]);
  return (
    <svg viewBox={box} className="h-[340px] w-full rounded-lg border border-border bg-card text-foreground" role="img" aria-label="Segmentation preview">
      <g transform="scale(1,-1)" fillRule="evenodd">
        {plan.segments.map((s, i) => (
          <path key={s.id} d={regionPath(s.finished)} fill={segmentFill(i)} stroke={segmentStroke(i)} strokeWidth={size / 600} />
        ))}
        {plan.segments
          .filter((s) => s.cut !== s.finished)
          .map((s) => (
            <path key={`${s.id}-cut`} d={regionPath(s.cut)} fill="none" stroke="currentColor" strokeWidth={size / 700} strokeDasharray={`${size / 120} ${size / 160}`} opacity={0.8} />
          ))}
        <path d={regionPath(region)} fill="none" stroke="currentColor" strokeWidth={size / 400} opacity={0.75} />
        {plan.seams.flatMap((m) =>
          seamLines(m).map((l, k) => <line key={`${m.id}-${k}`} {...l} stroke="hsl(35 95% 50%)" strokeWidth={size / 260} strokeLinecap="round" />),
        )}
      </g>
      {labels.map(({ id, p }) =>
        p ? (
          <text key={id} x={p[0]} y={-p[1]} fontSize={size / 42} textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontWeight={600}>
            {id}
          </text>
        ) : null,
      )}
    </svg>
  );
}

const statusChip = (s: string) =>
  s === "READY"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
    : s === "READY_SOLO"
      ? "bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-200"
      : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200";

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function SegmentationPanel({ group, nest, onClose }: { group: Group; nest: NestCtx; onClose?: () => void }) {
  const gr = React.useMemo(() => groupToRegion(group), [group]);
  const fit = React.useMemo(() => classifyFit(group, makeSettings({ W: nest.W, H: nest.H, mg: nest.mg, gp: 0, cell: 5, ro: nest.ro })), [group, nest]);

  const [form, setForm] = React.useState<SegForm>(() => defaultForm(nest));
  const [errors, setErrors] = React.useState<string[]>([]);
  const [cands, setCands] = React.useState<Candidate[] | null>(null);
  const [sel, setSel] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState<string[]>([]);
  const set = <K extends keyof SegForm>(k: K, v: SegForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const generate = React.useCallback(
    (f: SegForm) => {
      const parsed = parseForm(f, nest);
      if (!parsed.ok) {
        setErrors(parsed.errors);
        return;
      }
      setErrors([]);
      setBusy(true);
      setTimeout(() => {
        try {
          const list = generateCandidates(gr.region, parsed.settings);
          setCands(list.slice(0, 12));
          setSel(list[0]?.id ?? null);
          setConfirmed([]);
        } catch (e) {
          setErrors([e instanceof Error ? e.message : "Could not generate layouts."]);
          setCands(null);
        } finally {
          setBusy(false);
        }
      }, 30);
    },
    [gr, nest],
  );

  React.useEffect(() => {
    // run once when the dialog opens (deferred so no state is set synchronously inside the effect)
    const t = setTimeout(() => generate(defaultForm(nest)), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cand = cands?.find((c) => c.id === sel) ?? null;
  // re-validate the selected layout with the user's hole confirmations (cheap, exact)
  const plan = React.useMemo(
    () => (cand ? buildPlan(gr.region, { ...cand.plan.input, confirmedHoleCuts: confirmed }) : null),
    [cand, gr, confirmed],
  );

  const sources = form.sources;
  return (
    <div className="grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)]">
      {/* ---------------- settings ---------------- */}
      <div className="space-y-3 text-sm">
        <div className="rounded-lg border border-border p-3">
          <div className="font-semibold break-all">{group.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {mm(group.w)} × {mm(group.h)} mm · qty {group.qty}
            {group.th ? ` · ${group.th} mm` : ""}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusChip(fit.status)}`} title={fit.detail}>
              {fit.label}
            </span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-secondary-foreground">
              {gr.fidelity === "arcs" ? `${gr.arcs} arcs rebuilt exactly` : "polygon outline (no arcs found)"}
            </span>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="font-semibold">Source sheets</div>
          {sources.map((s, i) => (
            <div key={s.id} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
              <Field label={i === 0 ? "Length (mm)" : `Length ${i + 1}`}>
                <Input inputMode="decimal" value={s.length} onChange={(e) => set("sources", sources.map((x) => (x.id === s.id ? { ...x, length: e.target.value } : x)))} />
              </Field>
              <Field label={i === 0 ? "Width (mm)" : `Width ${i + 1}`}>
                <Input inputMode="decimal" value={s.width} onChange={(e) => set("sources", sources.map((x) => (x.id === s.id ? { ...x, width: e.target.value } : x)))} />
              </Field>
              <Button variant="ghost" size="icon" aria-label="Remove source sheet" disabled={sources.length < 2} onClick={() => set("sources", sources.filter((x) => x.id !== s.id))}>
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => set("sources", [...sources, { id: Math.max(0, ...sources.map((x) => x.id)) + 1, length: "", width: "" }])}>
            <Plus /> Add source sheet
          </Button>
          <p className="text-[11px] text-muted-foreground">
            Quantity is unlimited. Edge margin ({nest.mg} mm) and rotation come from the nest settings; the nest itself still uses its own sheet size.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="font-semibold">Direction &amp; pattern</div>
          <div className="grid grid-cols-3 gap-1.5">
            {(
              [
                ["H", "Horizontal"],
                ["V", "Vertical"],
                ["auto", "Auto"],
              ] as const
            ).map(([v, label]) => (
              <Button key={v} size="sm" variant={form.direction === v ? "default" : "outline"} onClick={() => set("direction", v)}>
                {label}
              </Button>
            ))}
          </div>
          <Field label="Strip pattern">
            <select className={selectCls} value={form.pattern} onChange={(e) => set("pattern", e.target.value as SegForm["pattern"])}>
              <option value="optimized">Optimized to the sheet (tries several offsets)</option>
              <option value="equal">Equal strips</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={form.staggered} onCheckedChange={(v) => set("staggered", v === true)} />
            Stagger seams between adjacent strips
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={form.allowSolo} onCheckedChange={(v) => set("allowSolo", v === true)} />
            Also try segments that need a margin-free sheet of their own
          </label>
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold">Segmentation Settings</div>
            <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/40 dark:text-sky-200">Optional</span>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={form.overlapOn} onCheckedChange={(v) => set("overlapOn", v === true)} />
            Enable overlap
          </label>
          <p className="text-[11px] text-muted-foreground">If enabled, the cut geometry of neighbouring segments overlaps by this value. Off by default; not a kerf or weld gap.</p>
          {form.overlapOn && (
            <>
              <Field label="Overlap value (mm)">
                <Input inputMode="decimal" placeholder="enter the value for your job" value={form.overlapMm} onChange={(e) => set("overlapMm", e.target.value)} />
              </Field>
              <Field label="Overlap carried by">
                <select className={selectCls} value={form.overlapSide} onChange={(e) => set("overlapSide", e.target.value as SegForm["overlapSide"])}>
                  <option value="alternate">Alternating segments</option>
                  <option value="A">Lower-coordinate segment</option>
                  <option value="symmetric">Both segments (half each)</option>
                </select>
              </Field>
            </>
          )}
        </div>

        <div className="space-y-2 rounded-lg border border-border p-3">
          <Field label="Cuts through holes">
            <select className={selectCls} value={form.holePolicy} onChange={(e) => set("holePolicy", e.target.value as SegForm["holePolicy"])}>
              <option value="reject">Reject</option>
              <option value="warn">Warn and let me confirm</option>
            </select>
          </Field>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Seam constraints (all optional)</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Field label="Min seam stagger (mm)">
                <Input inputMode="decimal" value={form.minStagger} onChange={(e) => set("minStagger", e.target.value)} />
              </Field>
              <Field label="Min seam-to-edge (mm)">
                <Input inputMode="decimal" value={form.minBoundary} onChange={(e) => set("minBoundary", e.target.value)} />
              </Field>
              <Field label="Max seam length (mm)">
                <Input inputMode="decimal" value={form.maxSeam} onChange={(e) => set("maxSeam", e.target.value)} />
              </Field>
              <Field label="Min segment size (mm)">
                <Input inputMode="decimal" value={form.minSegment} onChange={(e) => set("minSegment", e.target.value)} />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-muted-foreground">
                <Checkbox checked={form.forbidCross} onCheckedChange={(v) => set("forbidCross", v === true)} />
                No seams crossing at the same position
              </label>
            </div>
          </details>
        </div>

        {errors.length > 0 && (
          <ul className="space-y-1 rounded-lg border border-red-300 bg-red-50 p-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <Button className="w-full" disabled={busy} onClick={() => generate(form)}>
          {busy ? <Loader2 className="animate-spin" /> : <Layers />} Generate layouts
        </Button>
      </div>

      {/* ---------------- results ---------------- */}
      <div className="min-w-0 space-y-3">
        {busy && !cands && <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">Generating layouts…</div>}
        {cands && cands.length === 0 && (
          <div className="rounded-lg border border-border p-6 text-center text-sm text-muted-foreground">No layout could be generated with these settings.</div>
        )}
        {cands && cands.length > 0 && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Candidate layouts">
              {cands.map((c) => {
                const m = c.plan.metrics;
                const bad = c.plan.issues.filter((i) => i.severity === "error").length;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={c.id === sel}
                    onClick={() => {
                      setSel(c.id);
                      setConfirmed([]);
                    }}
                    className={`min-w-[190px] shrink-0 rounded-lg border p-2 text-left text-xs transition-colors ${
                      c.id === sel ? "border-primary bg-primary/5" : "border-border hover:bg-secondary"
                    }`}
                  >
                    <div className="font-semibold">{c.label}</div>
                    <div className="mt-1 text-muted-foreground">{candidateFacts(m).join(" · ")}</div>
                    <div className={`mt-1 font-medium ${bad ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                      {bad ? `${bad} error${bad > 1 ? "s" : ""}` : "valid"}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Listed by the area-based sheet lower bound, then segment count and seam length. Sheet counts are estimates from area; the nesting engine gives the real number. This order is not a cost optimum.
            </p>
          </>
        )}

        {plan && (
          <>
            <PlanPreview region={gr.region} plan={plan} />
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-secondary text-left text-muted-foreground">
                  <tr>
                    <th className="p-1.5">Segment</th>
                    <th className="p-1.5">Cut size (mm)</th>
                    <th className="p-1.5">Area (m²)</th>
                    <th className="p-1.5">Fit</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.segments.map((s) => (
                    <tr key={s.id} className="border-t border-border">
                      <td className="p-1.5 font-medium">{s.id}</td>
                      <td className="p-1.5">
                        {mm(s.bbox[2] - s.bbox[0])} × {mm(s.bbox[3] - s.bbox[1])}
                      </td>
                      <td className="p-1.5">{(s.finishedArea / 1e6).toFixed(3)}</td>
                      <td className="p-1.5">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusChip(s.fit.status)}`} title={s.fit.detail}>
                          {s.fit.status === "READY" ? "fits" : s.fit.status === "READY_SOLO" ? "solo sheet" : "does not fit"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {[
                ["Segments", String(plan.metrics.segments)],
                ["Seam length", `${(plan.metrics.cutLength / 1000).toFixed(2)} m`],
                ["Sheets (area lower bound)", plan.metrics.sheetsLowerBound === null ? "—" : `≥ ${plan.metrics.sheetsLowerBound}`],
                ["Overlap area", `${(plan.metrics.overlapArea / 1e6).toFixed(3)} m²`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border p-2">
                  <div className="text-muted-foreground">{k}</div>
                  <div className="text-sm font-semibold">{v}</div>
                </div>
              ))}
            </div>
            {plan.issues.length > 0 && (
              <ul className="space-y-1 text-xs" aria-label="Validation">
                {plan.issues.map((i, k) => (
                  <li
                    key={`${i.code}-${k}`}
                    className={`rounded-md border px-2 py-1 ${
                      i.severity === "error"
                        ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                        : i.severity === "warning"
                          ? "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
                          : "border-border text-muted-foreground"
                    }`}
                  >
                    {i.message}
                    {i.code === "HOLE_CUT_UNCONFIRMED" && i.cutId && (
                      <label className="mt-1 flex items-center gap-2 font-medium">
                        <Checkbox
                          checked={confirmed.includes(i.cutId)}
                          onCheckedChange={(v) => setConfirmed((c) => (v === true ? [...c, i.cutId!] : c.filter((x) => x !== i.cutId)))}
                        />
                        I accept cutting through the hole at {i.cutId}
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="col-span-full flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">Preview only: nothing is changed in your nest. Creating the segments as parts comes in the next phase.</p>
        <DialogFooterButtons onClose={onClose} />
      </div>
    </div>
  );
}

function DialogFooterButtons({ onClose }: { onClose?: () => void }) {
  return (
    <div className="flex gap-2">
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
      <Button disabled title="Creating the segments as parts is added in the next phase">
        Approve segmentation
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

export function SegmentDialog({
  open,
  onOpenChange,
  group,
  nest,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group | null;
  nest: NestCtx;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94vh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Segment part</DialogTitle>
          <DialogDescription>Split an oversized part into pieces that fit the source sheets. Review the proposed layouts before anything is created.</DialogDescription>
        </DialogHeader>
        {group && <SegmentationPanel key={group.id} group={group} nest={nest} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
