/**
 * Segmentation dialog — form state, validation and mapping to `GenSettings`.
 * Kept free of React so it can be unit-tested.
 *
 * Source sheets: the user types a length and a width for each source. They map to the nest's
 * W (length) and H (width). Nothing is assumed beyond the nest's own sheet size, which is only
 * used to pre-fill the first source.
 */
import type { GenSettings, HolePolicy, OverlapSide, PlanInput, SeamConstraints } from "./planner";

export interface SourceForm {
  id: number;
  /** Sheet length, mm (the nest's W). */
  length: string;
  /** Sheet width, mm (the nest's H). */
  width: string;
}

export interface SegForm {
  sources: SourceForm[];
  direction: "H" | "V" | "auto";
  pattern: "equal" | "optimized";
  staggered: boolean;
  allowSolo: boolean;
  overlapOn: boolean;
  /** Empty until the user types a value — there is no default overlap. */
  overlapMm: string;
  overlapSide: OverlapSide;
  holePolicy: HolePolicy;
  minStagger: string;
  minBoundary: string;
  maxSeam: string;
  minSegment: string;
  forbidCross: boolean;
}

export interface NestCtx {
  /** The nest's sheet length / width (mm), edge margin (mm) and rotation setting (0–4). */
  W: number;
  H: number;
  mg: number;
  ro: number;
}

export function defaultForm(nest: Pick<NestCtx, "W" | "H">): SegForm {
  return {
    sources: [{ id: 1, length: String(nest.W), width: String(nest.H) }],
    direction: "auto",
    pattern: "optimized",
    staggered: true,
    allowSolo: true,
    overlapOn: false,
    overlapMm: "",
    overlapSide: "alternate",
    holePolicy: "reject",
    minStagger: "",
    minBoundary: "",
    maxSeam: "",
    minSegment: "",
    forbidCross: false,
  };
}

export type ParsedForm = { ok: true; settings: GenSettings } | { ok: false; errors: string[] };

const num = (s: string) => (s.trim() === "" ? NaN : Number(s.replace(",", ".")));

/** Validates the form; `confirmedHoleCuts` is carried through unchanged. */
export function parseForm(f: SegForm, nest: Pick<NestCtx, "mg" | "ro">, confirmedHoleCuts: string[] = []): ParsedForm {
  const errors: string[] = [];

  const sheets = f.sources.map((s, i) => ({ W: num(s.length), H: num(s.width), i }));
  if (!sheets.length) errors.push("Add at least one source sheet.");
  for (const s of sheets) {
    if (!(s.W > 0) || !(s.H > 0)) errors.push(`Source ${s.i + 1}: enter a length and a width greater than 0.`);
  }

  let overlapMm = 0;
  if (f.overlapOn) {
    overlapMm = num(f.overlapMm);
    if (!(overlapMm > 0)) errors.push("Overlap is enabled: enter an overlap value greater than 0 (or turn it off).");
  }

  const cons: SeamConstraints = {};
  const optional = (value: string, label: string, set: (v: number) => void, positive = true) => {
    if (value.trim() === "") return;
    const v = num(value);
    if (!(positive ? v > 0 : v >= 0)) errors.push(`${label}: enter a number${positive ? " greater than 0" : ""}, or leave it empty.`);
    else set(v);
  };
  optional(f.minStagger, "Min seam stagger", (v) => (cons.minSeamStagger = v));
  optional(f.minBoundary, "Min seam-to-boundary distance", (v) => (cons.minSeamToBoundary = v));
  optional(f.maxSeam, "Max seam length", (v) => (cons.maxSeamLength = v));
  optional(f.minSegment, "Min segment size", (v) => (cons.minSegmentMm = v));
  if (f.forbidCross) cons.forbidCrossJunctions = true;

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    settings: {
      directions: f.direction === "auto" ? ["H", "V"] : [f.direction],
      sheet: { sheets: sheets.map(({ W, H }) => ({ W, H })), mg: nest.mg, ro: nest.ro },
      overlap: { enabled: f.overlapOn, mm: f.overlapOn ? overlapMm : 0, side: f.overlapSide },
      holePolicy: f.holePolicy,
      constraints: Object.keys(cons).length ? cons : undefined,
      staggered: f.staggered,
      allowSolo: f.allowSolo,
      pattern: f.pattern,
      confirmedHoleCuts,
    },
  };
}

const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: d });

/** Short facts shown on a candidate card. */
export function candidateFacts(m: { segments: number; cutLength: number; sheetsLowerBound: number | null; soloSegments: number }): string[] {
  const out = [`${m.segments} segment${m.segments === 1 ? "" : "s"}`, `${fmt(m.cutLength / 1000, 2)} m of seams`];
  if (m.sheetsLowerBound !== null) out.push(`≥ ${m.sheetsLowerBound} sheet${m.sheetsLowerBound === 1 ? "" : "s"} (by area)`);
  if (m.soloSegments) out.push(`${m.soloSegments} solo`);
  return out;
}

/**
 * Everything in a `PlanInput` except the cuts, read leniently from the form so a layout is
 * re-validated live while the user edits settings or cuts. Values that are not valid numbers are
 * passed on as NaN / dropped, and `buildPlan` reports them (e.g. INVALID_OVERLAP) instead of throwing.
 */
export function planBaseFromForm(
  f: SegForm,
  nest: Pick<NestCtx, "mg" | "ro">,
  confirmedHoleCuts: string[] = [],
): Omit<PlanInput, "direction" | "stripCuts" | "seamCuts"> {
  const cons: SeamConstraints = {};
  const opt = (s: string, set: (v: number) => void) => {
    const v = num(s);
    if (v > 0) set(v);
  };
  opt(f.minStagger, (v) => (cons.minSeamStagger = v));
  opt(f.minBoundary, (v) => (cons.minSeamToBoundary = v));
  opt(f.maxSeam, (v) => (cons.maxSeamLength = v));
  opt(f.minSegment, (v) => (cons.minSegmentMm = v));
  if (f.forbidCross) cons.forbidCrossJunctions = true;
  return {
    overlap: { enabled: f.overlapOn, mm: f.overlapOn ? num(f.overlapMm) : 0, side: f.overlapSide },
    sheet: {
      sheets: f.sources.map((s) => ({ W: num(s.length), H: num(s.width) })).filter((s) => s.W > 0 && s.H > 0),
      mg: nest.mg,
      ro: nest.ro,
    },
    holePolicy: f.holePolicy,
    confirmedHoleCuts,
    constraints: Object.keys(cons).length ? cons : undefined,
  };
}
