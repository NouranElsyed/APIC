/**
 * Nozzle calculator (pure functions).
 *
 *   neck   = projection (m) × kg/m of the STD pipe
 *   flange = purchased WN RF class 150 (table)            — or fabricated from plate for the DN600 manhole
 *   pad    = π/4 × (padDia² − pipeOD²) × padThk × 7.85e-6   — DN ≤ 50 has none
 *   unit   = neck + flange + pad                           — same definition as the workbook's "Unit wt"
 *
 * Every default can be overridden per nozzle; an override is reported in `overrides` so it is never silent.
 */
import {
  FLANGE_WN_150_KG,
  MANHOLE,
  NO_PAD_MAX_DN,
  PAD_DIA,
  PAD_ESTIMATE_FACTOR,
  PAD_THK,
  PIPE_STD,
  STEEL_KG_PER_MM3,
  type NozzleLocation,
} from "./data";

export type { NozzleLocation };
export type NozzleKind = "nozzle" | "manhole";

export interface NozzleInput {
  mark: string;
  location: NozzleLocation;
  /** "manhole" = DN600 API-650 manhole (flange ring and cover made from plate). Default "nozzle". */
  kind?: NozzleKind;
  dn: number;
  /** Projection of the neck, mm. */
  projectionMm: number;
  qty: number;
  /* ---- optional overrides ---- */
  padDiaMm?: number;
  padThkMm?: number;
  /** Force "no pad". */
  noPad?: boolean;
  /** Replace the catalogue flange weight, kg. */
  flangeKg?: number;
}

export type PadSource = "table" | "other-location" | "estimate" | "override" | "none";

export interface FlatPart {
  name: string;
  kind: "pad" | "manhole-ring" | "manhole-cover";
  /** Outside diameter, mm. */
  outerDia: number;
  /** Inside diameter, mm (0 = solid disc). */
  innerDia: number;
  thkMm: number;
  /** Pieces for the whole row (per-nozzle count × qty). */
  qty: number;
  kgEach: number;
}

export interface NozzleResult {
  ok: true;
  input: NozzleInput;
  odMm: number;
  neckKg: number;
  flangeKg: number;
  padKg: number;
  /** neck + flange + pad (the workbook's "Unit wt"). Excludes the fabricated manhole parts. */
  unitKg: number;
  /** unitKg × qty. */
  totalKg: number;
  /** Manhole flange ring + cover, per nozzle (0 for a normal nozzle). Listed separately, as in the workbook. */
  fabricatedKg: number;
  pad: { diaMm: number; thkMm: number; source: PadSource };
  flangeSource: "catalogue" | "fabricated" | "override";
  flatParts: FlatPart[];
  /** Things the user should look at (estimated pad, ...). */
  warnings: string[];
  /** Defaults that were replaced by the user. */
  overrides: string[];
}

export type NozzleOutcome = NozzleResult | { ok: false; input: NozzleInput; error: string };

const ring = (outer: number, inner: number, thk: number) => (Math.PI / 4) * (outer * outer - inner * inner) * thk * STEEL_KG_PER_MM3;
/** Pad Ø used when a size has no pad entry at all: 2.2 × pipe OD, rounded to 5 mm. */
export const estimatePadDia = (odMm: number): number => Math.round((PAD_ESTIMATE_FACTOR * odMm) / 5) * 5;

export function calcNozzle(input: NozzleInput): NozzleOutcome {
  const fail = (error: string): NozzleOutcome => ({ ok: false, input, error });
  const kind = input.kind ?? "nozzle";
  const pipe = PIPE_STD[input.dn];
  if (!pipe) return fail(`DN${input.dn} is not in the pipe library — add it to data.ts (PIPE_STD).`);
  if (!(input.projectionMm > 0)) return fail("Projection must be greater than 0.");
  if (!Number.isInteger(input.qty) || input.qty < 1) return fail("Quantity must be a whole number, at least 1.");
  if (kind === "manhole" && input.dn !== MANHOLE.dn) return fail(`Only the DN${MANHOLE.dn} API-650 manhole is in the library.`);

  const warnings: string[] = [];
  const overrides: string[] = [];
  const neckKg = (input.projectionMm / 1000) * pipe.kgPerM;

  /* ---- flange ---- */
  let flangeKg = 0;
  let flangeSource: NozzleResult["flangeSource"] = "catalogue";
  if (kind === "manhole") flangeSource = "fabricated";
  else if (FLANGE_WN_150_KG[input.dn] === undefined && input.flangeKg === undefined) {
    return fail(`No class 150 flange weight for DN${input.dn} — enter it as an override or add it to data.ts.`);
  } else flangeKg = FLANGE_WN_150_KG[input.dn] ?? 0;
  if (input.flangeKg !== undefined && kind !== "manhole") {
    if (FLANGE_WN_150_KG[input.dn] !== undefined && input.flangeKg !== flangeKg) overrides.push(`flange weight ${input.flangeKg} kg instead of ${flangeKg} kg`);
    flangeKg = input.flangeKg;
    flangeSource = "override";
  }

  /* ---- pad ---- */
  const defaultThk = PAD_THK[input.location];
  let padDia = 0;
  let padThk = 0;
  let source: PadSource = "none";
  if (input.noPad) {
    if (input.dn > NO_PAD_MAX_DN) overrides.push("no reinforcing pad");
  } else if (input.dn <= NO_PAD_MAX_DN && input.padDiaMm === undefined) {
    // small nozzle: no pad by rule
  } else {
    const other: NozzleLocation = input.location === "shell" ? "roof" : "shell";
    const fromTable = PAD_DIA[input.location][input.dn];
    const fromOther = PAD_DIA[other][input.dn];
    if (input.padDiaMm !== undefined) {
      padDia = input.padDiaMm;
      source = "override";
      if (fromTable !== padDia) overrides.push(`pad Ø${padDia} mm instead of ${fromTable ? `Ø${fromTable} mm` : "the default"}`);
    } else if (fromTable !== undefined) {
      padDia = fromTable;
      source = "table";
    } else if (fromOther !== undefined) {
      padDia = fromOther;
      source = "other-location";
      warnings.push(`No ${input.location} pad size for DN${input.dn}: the ${other} one (Ø${fromOther} mm) was used. Confirm it.`);
    } else {
      padDia = estimatePadDia(pipe.od);
      source = "estimate";
      warnings.push(`No pad size for DN${input.dn}: Ø${padDia} mm is an estimate (${PAD_ESTIMATE_FACTOR} × OD). Confirm it.`);
    }
    padThk = input.padThkMm ?? defaultThk;
    if (input.padThkMm !== undefined && input.padThkMm !== defaultThk) overrides.push(`pad thickness ${input.padThkMm} mm instead of ${defaultThk} mm`);
    if (!(padDia > pipe.od)) return fail(`Pad Ø${padDia} mm must be larger than the pipe OD (${pipe.od} mm).`);
    if (!(padThk > 0)) return fail("Pad thickness must be greater than 0.");
  }
  const padKg = padDia ? ring(padDia, pipe.od, padThk) : 0;

  /* ---- flat parts (for nesting) and the fabricated manhole parts ---- */
  const flatParts: FlatPart[] = [];
  if (padDia) {
    flatParts.push({
      name: `Reinforcing pad DN${input.dn} Ø${padDia}/Ø${pipe.od} × ${padThk}`,
      kind: "pad",
      outerDia: padDia,
      innerDia: pipe.od,
      thkMm: padThk,
      qty: input.qty,
      kgEach: padKg,
    });
  }
  let fabricatedKg = 0;
  if (kind === "manhole") {
    const { ring: r, cover: c } = MANHOLE;
    const ringOuter = r.meanDia + r.width;
    const ringInner = r.meanDia - r.width;
    const ringKg = ring(ringOuter, ringInner, r.thk);
    const coverKg = ring(c.dia, 0, c.thk);
    fabricatedKg = ringKg + coverKg;
    flatParts.push(
      { name: `Manhole flange ring Ø${ringOuter}/Ø${ringInner} × ${r.thk}`, kind: "manhole-ring", outerDia: ringOuter, innerDia: ringInner, thkMm: r.thk, qty: input.qty, kgEach: ringKg },
      { name: `Manhole cover Ø${c.dia} × ${c.thk}`, kind: "manhole-cover", outerDia: c.dia, innerDia: 0, thkMm: c.thk, qty: input.qty, kgEach: coverKg },
    );
  }

  const unitKg = neckKg + flangeKg + padKg;
  return {
    ok: true,
    input,
    odMm: pipe.od,
    neckKg,
    flangeKg,
    padKg,
    unitKg,
    totalKg: unitKg * input.qty,
    fabricatedKg,
    pad: { diaMm: padDia, thkMm: padThk, source },
    flangeSource,
    flatParts,
    warnings,
    overrides,
  };
}

export interface ScheduleTotals {
  count: number;
  neckKg: number;
  flangeKg: number;
  padKg: number;
  /** Σ unit × qty — the figure the workbook adds to the tank weight as nozzle neck + flange + pads. */
  totalKg: number;
  /** Σ manhole ring + cover × qty — already part of the tank components in the workbook, shown separately. */
  fabricatedKg: number;
  /** Flat parts grouped by identical name. */
  flatParts: FlatPart[];
  errors: number;
}

export function scheduleTotals(outcomes: NozzleOutcome[]): ScheduleTotals {
  const t: ScheduleTotals = { count: 0, neckKg: 0, flangeKg: 0, padKg: 0, totalKg: 0, fabricatedKg: 0, flatParts: [], errors: 0 };
  const parts = new Map<string, FlatPart>();
  for (const o of outcomes) {
    if (!o.ok) {
      t.errors++;
      continue;
    }
    const q = o.input.qty;
    t.count += q;
    t.neckKg += o.neckKg * q;
    t.flangeKg += o.flangeKg * q;
    t.padKg += o.padKg * q;
    t.totalKg += o.totalKg;
    t.fabricatedKg += o.fabricatedKg * q;
    for (const p of o.flatParts) {
      const have = parts.get(p.name);
      if (have) have.qty += p.qty;
      else parts.set(p.name, { ...p });
    }
  }
  t.flatParts = [...parts.values()];
  return t;
}
