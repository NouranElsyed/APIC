// Nest Boost 1D engine — linear cutting-stock nesting for hot-rolled stock:
// plates cut as bars, pipes, angles, channels, etc. Every part has a single
// length; stock is cut from fixed-length bars along one axis only.
// Modelled after the "Plans / Sources / Parts / Settings / Results" workflow
// of dedicated 1D cutting-optimization software. Pure client-side, no
// server or database involved.

/** What a part is made of, so it can be told apart in the list (plate strip, rolled section, pipe). */
export type PartType1D = "PLATE" | "HOT_ROLLED" | "PIPE";

export const PART_TYPES_1D: { value: PartType1D; label: string }[] = [
  { value: "HOT_ROLLED", label: "Hot rolled" },
  { value: "PLATE", label: "Plate" },
  { value: "PIPE", label: "Pipe" },
];

export const DEFAULT_PART_TYPE_1D: PartType1D = "HOT_ROLLED";

export interface Piece1D {
  id: number;
  /** Serial number shown next to the part. */
  sn: number;
  name: string;
  /** Profile / section, e.g. "IPE200", "L40x40x4", 'PIPE 2" SCH40' ("" = unknown). */
  profile: string;
  /** Material grade/spec, e.g. "S235" ("" = unknown). */
  material: string;
  /** Cut length in mm. */
  length: number;
  qty: number;
  /** Plate / hot rolled / pipe (missing = hot rolled). */
  partType?: PartType1D;
}

/** One available stock length for a given profile + material (a "Source"). */
export interface Source1D {
  id: number;
  sn: number;
  profile: string;
  material: string;
  /** Stock bar length in mm. */
  length: number;
  /** How many bars of this length are available. null = unlimited. */
  qty: number | null;
  /** Cost per bar, optional (used only to display total cost). */
  cost: number;
  description: string;
}

export interface Settings1D {
  /** Saw / cut width lost between two pieces, in mm. */
  kerf: number;
  /** Length trimmed off the left end of the stock bar (mm). */
  leftTrim: number;
  /** Length trimmed off the right end of the stock bar (mm). */
  rightTrim: number;
  /** Extra length reserved for the saw's clamp/grip, lost in addition to the trims (mm). */
  gripping: number;
  /** Prefer reusing existing cutting patterns over minimizing scrap, to end up with fewer
   *  distinct layouts (patterns) to set up on the saw, at the cost of a bit more waste. */
  minimizeLayoutCount: boolean;
  /** Max cuts allowed on one bar (0 = no limit). */
  maxPartsInLayout: number;
  /** Max distinct part lengths allowed on one bar (0 = no limit). */
  maxDistinctLengthsInLayout: number;
  /** Two different part lengths may only share a bar if they differ by at least this much (mm). */
  minLengthDiffInLayout: number;
  /** A leftover shorter than this is scrap; at or above it, it's kept as a reusable remnant. */
  remnantMinLength: number;
  /** Leftover lengths in [restrictedFrom, restrictedTo] are flagged as an unusable "dead" rest
   *  (e.g. too short to reuse, too long to call scrap) — set both to 0 to disable. */
  restrictedRestFrom: number;
  restrictedRestTo: number;
}

export interface Cut {
  piece: Piece1D;
  /** Start position along the bar, in mm, measured from the trimmed start. */
  pos: number;
}

/** One physical bar that was cut, tied to the Source it was cut from. */
export interface Bar {
  sourceId: number;
  sourceLength: number;
  profile: string;
  material: string;
  cuts: Cut[];
  /** Actual physical bar length used (defaults to sourceLength; can be trimmed down
   *  after nesting to cut less material / less scrap). */
  length?: number;
}

/** A distinct cutting pattern (which bar length + which cuts at which positions) and how
 *  many physical bars use exactly that pattern — this is what a saw operator sets up once
 *  and repeats, instead of re-reading a different layout for every single bar. */
export interface Layout {
  bars: Bar[]; // all bars sharing this exact pattern; bars[0] is the representative layout
  repeat: number;
}

export interface UsedSource {
  sourceId: number;
  length: number;
  count: number;
}

export interface Result1D {
  layouts: Layout[];
  usedSources: UsedSource[];
  /** Pieces that could not be nested at all (longer than any usable source). */
  skip: string[];
  /** Non-fatal warnings, e.g. a bar's leftover falls in the restricted "dead" rest range. */
  problems: string[];
}

export interface Counters1D {
  id: number;
  sn: number;
}

// ------------------------------------------------------------------- pieces & sources

export function lotKey(profile: string, material: string): string {
  const n = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
  return `${n(profile)}\u0000${n(material)}`;
}

/** Merges a manually entered piece into `pieces` (identical pieces share one row with a higher quantity). */
export function addPiece(
  pieces: Piece1D[],
  input: { name: string; profile: string; material: string; length: number; qty: number; partType?: PartType1D },
  counters: Counters1D,
): Piece1D[] {
  const profile = input.profile.trim();
  const material = input.material.trim();
  const length = Math.max(0, input.length);
  const qty = Math.max(1, Math.round(input.qty || 1));
  const partType = input.partType ?? DEFAULT_PART_TYPE_1D;
  const out = pieces.slice();
  const m = out.find(
    (p) =>
      p.profile === profile &&
      p.material === material &&
      (p.partType ?? DEFAULT_PART_TYPE_1D) === partType &&
      Math.abs(p.length - length) < 0.05,
  );
  if (m) out[out.indexOf(m)] = { ...m, qty: m.qty + qty };
  else out.push({ id: counters.id++, sn: ++counters.sn, name: input.name || `Part #${counters.sn}`, profile, material, length, qty, partType });
  return out;
}

/** Adds a stock length (a "Source") available for a given profile + material. */
export function addSource(
  sources: Source1D[],
  input: { profile: string; material: string; length: number; qty: number | null; cost: number; description: string },
  counters: Counters1D,
): Source1D[] {
  return [
    ...sources,
    {
      id: counters.id++,
      sn: ++counters.sn,
      profile: input.profile.trim(),
      material: input.material.trim(),
      length: Math.max(0, input.length),
      qty: input.qty === null ? null : Math.max(0, Math.round(input.qty)),
      cost: Math.max(0, input.cost || 0),
      description: input.description,
    },
  ];
}

/** Usable length of a bar of the given stock length, after trims and gripping. */
export function usableLength(sourceLength: number, S: Settings1D): number {
  return Math.max(0, sourceLength - S.leftTrim - S.rightTrim - S.gripping);
}

// ------------------------------------------------------------------------ packing

interface OpenBar {
  sourceId: number;
  sourceLength: number;
  usable: number;
  cuts: Cut[];
  used: number; // length already consumed, including internal kerfs
}

function distinctLengths(b: OpenBar): number {
  return new Set(b.cuts.map((c) => Math.round(c.piece.length * 100))).size;
}

function fits(b: OpenBar, p: Piece1D, S: Settings1D): boolean {
  const need = p.length + (b.cuts.length ? S.kerf : 0);
  if (b.used + need > b.usable + 1e-6) return false;
  if (S.maxPartsInLayout > 0 && b.cuts.length + 1 > S.maxPartsInLayout) return false;
  if (S.maxDistinctLengthsInLayout > 0) {
    const already = b.cuts.some((c) => Math.abs(c.piece.length - p.length) < 1e-6);
    if (!already && distinctLengths(b) + 1 > S.maxDistinctLengthsInLayout) return false;
  }
  if (S.minLengthDiffInLayout > 0) {
    for (const c of b.cuts) {
      const d = Math.abs(c.piece.length - p.length);
      if (d > 1e-6 && d < S.minLengthDiffInLayout) return false;
    }
  }
  return true;
}

/**
 * Best-Fit / First-Fit-Decreasing bin packing, run separately per (profile, material)
 * lot, picking from that lot's Sources (multiple stock lengths, limited or unlimited
 * quantity). Groups identical bars into Layouts with a repeat count, flags reusable
 * remnants and "dead" rest lengths, and reports pieces that could not be cut.
 *
 * This is a heuristic (as is any practical cutting-stock solver) — layout-count and
 * length-difference constraints are honoured on a best-effort basis, not
 * guaranteed-optimal.
 */
export function runOptimize1D(pieces: Piece1D[], sources: Source1D[], S: Settings1D): Result1D {
  const skip: string[] = [];
  const problems: string[] = [];
  const allBars: OpenBar[] = [];

  const lots = new Map<string, { pieces: Piece1D[]; sources: Source1D[] }>();
  const ensureLot = (profile: string, material: string) => {
    const key = lotKey(profile, material);
    if (!lots.has(key)) lots.set(key, { pieces: [], sources: [] });
    return lots.get(key)!;
  };
  for (const p of pieces) if (p.qty) ensureLot(p.profile, p.material).pieces.push(p);
  for (const s of sources) ensureLot(s.profile, s.material).sources.push(s);

  for (const [, lot] of lots) {
    const stock = lot.sources
      .map((s) => ({ src: s, remaining: s.qty }))
      .sort((a, b) => a.src.length - b.src.length);
    const lotBars: OpenBar[] = [];

    const items: Piece1D[] = [];
    for (const p of lot.pieces) for (let i = 0; i < p.qty; i++) items.push(p);
    items.sort((a, b) => b.length - a.length);

    for (const p of items) {
      // 1) try to fit into an existing open bar of this lot.
      let target: OpenBar | null = null;
      for (const b of lotBars) {
        if (!fits(b, p, S)) continue;
        if (S.minimizeLayoutCount) {
          target = b; // first-fit: reuse the earliest pattern that works
          break;
        }
        // best-fit: the bar that will have the least room left over
        const room = b.usable - b.used - (p.length + (b.cuts.length ? S.kerf : 0));
        if (!target) target = b;
        else {
          const targetRoom = target.usable - target.used - (p.length + (target.cuts.length ? S.kerf : 0));
          if (room < targetRoom) target = b;
        }
      }
      if (target) {
        const addKerf = target.cuts.length ? S.kerf : 0;
        target.cuts.push({ piece: p, pos: target.used + addKerf });
        target.used += p.length + addKerf;
        continue;
      }
      // 2) open a new bar from the smallest stock length (by remaining qty) that fits.
      let pick: { src: Source1D; remaining: number | null } | null = null;
      for (const st of stock) {
        if (st.remaining === 0) continue;
        if (usableLength(st.src.length, S) + 1e-6 >= p.length) {
          pick = st;
          break;
        }
      }
      if (!pick) {
        const msg =
          `Part #${p.sn} (${p.name}, ${p.profile || "?"} ${p.material || ""}) is ${Math.round(p.length)} mm — no stock source with a matching profile/material is long enough (after kerf/trim/gripping)`;
        // report once per part, not once per piece of its quantity
        if (!skip.includes(msg)) skip.push(msg);
        continue;
      }
      if (pick.remaining !== null) {
        const st = stock.find((x) => x.src.id === pick!.src.id)!;
        st.remaining = (st.remaining as number) - 1;
      }
      const usable = usableLength(pick.src.length, S);
      const nb: OpenBar = { sourceId: pick.src.id, sourceLength: pick.src.length, usable, cuts: [{ piece: p, pos: 0 }], used: p.length };
      lotBars.push(nb);
    }
    allBars.push(...lotBars);
  }

  // remnant / restricted-rest flags
  allBars.forEach((b, i) => {
    const rest = b.usable - b.used;
    if (S.restrictedRestTo > S.restrictedRestFrom && rest >= S.restrictedRestFrom && rest <= S.restrictedRestTo) {
      problems.push(
        `Bar ${i + 1} (${Math.round(b.sourceLength)} mm) leaves a ${Math.round(rest)} mm rest, inside the restricted "dead" range ${S.restrictedRestFrom}–${S.restrictedRestTo} mm`,
      );
    }
  });

  // group identical bars into layouts (same source + same ordered set of piece ids)
  const groups = new Map<string, Bar[]>();
  for (const b of allBars) {
    const key = `${b.sourceId}|${b.cuts.map((c) => c.piece.id).join(",")}`;
    const bar: Bar = {
      sourceId: b.sourceId,
      sourceLength: b.sourceLength,
      profile: b.cuts[0]?.piece.profile ?? "",
      material: b.cuts[0]?.piece.material ?? "",
      cuts: b.cuts,
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(bar);
  }
  const layouts: Layout[] = Array.from(groups.values()).map((bars) => ({ bars, repeat: bars.length }));
  layouts.sort((a, b) => b.repeat - a.repeat);

  const usedMap = new Map<number, UsedSource>();
  for (const b of allBars) {
    const cur = usedMap.get(b.sourceId) ?? { sourceId: b.sourceId, length: b.sourceLength, count: 0 };
    cur.count++;
    usedMap.set(b.sourceId, cur);
  }

  return { layouts, usedSources: Array.from(usedMap.values()), skip, problems };
}

// ------------------------------------------------------------------------ stats / trim

/** Total length used by the cuts on a bar (last cut's end), in mm. */
export function barUsedLength(b: Bar): number {
  let end = 0;
  for (const c of b.cuts) end = Math.max(end, c.pos + c.piece.length);
  return end;
}

export function barStats(b: Bar, S: Settings1D) {
  const used = barUsedLength(b);
  const L = b.length ?? b.sourceLength;
  const usable = usableLength(L, S);
  const rest = Math.max(0, usable - used);
  return {
    pieces: b.cuts.length,
    usedLength: Math.round(used),
    rest: Math.round(rest),
    isRemnant: rest >= S.remnantMinLength,
    utilization: L > 0 ? (100 * b.cuts.reduce((s, c) => s + c.piece.length, 0)) / L : 0,
  };
}

/** Smallest physical bar length this bar can be trimmed to without cutting into its pieces. */
export function minBarLength(b: Bar, S: Settings1D): number {
  return Math.round(barUsedLength(b) + S.leftTrim + S.rightTrim + S.gripping);
}

/**
 * Trims (or restores) a bar's physical length, e.g. to buy/cut a shorter stock
 * bar for a partly-used bar and reduce scrap. Clamped between the minimum
 * needed to hold its cuts and the original stock (source) length.
 * Returns the length actually applied.
 */
export function resizeBar(b: Bar, S: Settings1D, length: number): number {
  const min = minBarLength(b, S);
  const L = Math.min(b.sourceLength, Math.max(min, Math.round(length)));
  b.length = L;
  return L;
}

// ------------------------------------------------------------------------------ summary

export function overallStats(res: Result1D, sources: Source1D[]) {
  let totalPieceLength = 0;
  let totalBarLength = 0;
  let cutParts = 0;
  let bars = 0;
  for (const l of res.layouts)
    for (const b of l.bars) {
      bars++;
      cutParts += b.cuts.length;
      totalPieceLength += b.cuts.reduce((s, c) => s + c.piece.length, 0);
      totalBarLength += b.length ?? b.sourceLength;
    }
  const costById = new Map(sources.map((s) => [s.id, s.cost]));
  const totalCost = res.usedSources.reduce((s, u) => s + (costById.get(u.sourceId) ?? 0) * u.count, 0);
  return {
    bars,
    layouts: res.layouts.length,
    cutParts,
    yieldPct: totalBarLength > 0 ? (100 * totalPieceLength) / totalBarLength : 0,
    totalBarLength: Math.round(totalBarLength),
    totalCost,
  };
}

// ---------------------------------------------------------------------------- export

/** Plain-text cut list, grouped by layout with its repeat count. */
export function buildCutList(res: Result1D, S: Settings1D): string {
  const lines: string[] = [];
  res.layouts.forEach((l, i) => {
    const b = l.bars[0];
    const L = b.length ?? b.sourceLength;
    lines.push(`Layout ${i + 1} — ${b.profile || "?"} ${b.material ? `— ${b.material} ` : ""}(${Math.round(L)} mm bar) × ${l.repeat}`);
    b.cuts
      .slice()
      .sort((a, c) => a.pos - c.pos)
      .forEach((c) => lines.push(`  #${c.piece.sn} ${c.piece.name} — ${Math.round(c.piece.length)} mm @ ${Math.round(c.pos)} mm`));
  });
  return lines.join("\n");
}

/** CSV cut list, one row per cut, repeated per layout occurrence. */
export function buildCutListCsv(res: Result1D, S: Settings1D): string {
  const rows = ["Layout,Repeat,Profile,Material,Bar length (mm),Part #,Part name,Cut length (mm),Position (mm)"];
  res.layouts.forEach((l, i) => {
    const b = l.bars[0];
    const L = b.length ?? b.sourceLength;
    b.cuts
      .slice()
      .sort((a, c) => a.pos - c.pos)
      .forEach((c) => {
        rows.push(
          [i + 1, l.repeat, b.profile, b.material, Math.round(L), c.piece.sn, c.piece.name, Math.round(c.piece.length), Math.round(c.pos)]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        );
      });
  });
  return rows.join("\n");
}