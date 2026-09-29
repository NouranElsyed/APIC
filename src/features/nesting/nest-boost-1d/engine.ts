// Nest Boost 1D engine — linear cutting-stock nesting for hot-rolled stock:
// plates cut as bars, pipes, angles, channels, etc. Every part has a single
// length; stock is cut from fixed-length bars along one axis only.
// Pure client-side code, no server or database involved.

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
}

export interface Settings1D {
  /** Stock bar length in mm. */
  barLength: number;
  /** Saw / cut width lost between two pieces, in mm. */
  kerf: number;
  /** Length trimmed off each end of the stock bar (mm). */
  endTrim: number;
}

export interface Cut {
  piece: Piece1D;
  /** Start position along the bar, in mm, measured from the trimmed start. */
  pos: number;
}

export interface Bar {
  profile: string;
  material: string;
  cuts: Cut[];
  /** Actual physical bar length used (defaults to Settings1D.barLength; can be
   *  trimmed down after nesting to cut less material / less scrap). */
  length?: number;
}

export interface Result1D {
  bars: Bar[];
  /** Piece serial numbers that could not be nested at all (longer than a usable bar). */
  skip: string[];
}

export interface Counters1D {
  id: number;
  sn: number;
}

/** Merges a manually entered piece into `pieces` (identical pieces share one row with a higher quantity). */
export function addPiece(
  pieces: Piece1D[],
  input: { name: string; profile: string; material: string; length: number; qty: number },
  counters: Counters1D,
): Piece1D[] {
  const profile = input.profile.trim();
  const material = input.material.trim();
  const length = Math.max(0, input.length);
  const qty = Math.max(1, Math.round(input.qty || 1));
  const out = pieces.slice();
  const m = out.find(
    (p) => p.profile === profile && p.material === material && Math.abs(p.length - length) < 0.05,
  );
  if (m) out[out.indexOf(m)] = { ...m, qty: m.qty + qty };
  else out.push({ id: counters.id++, sn: ++counters.sn, name: input.name || `Part #${counters.sn}`, profile, material, length, qty });
  return out;
}

/** Usable length of one stock bar after the two end trims. */
export function usableBarLength(S: Settings1D): number {
  return Math.max(0, S.barLength - 2 * S.endTrim);
}

/**
 * First-Fit-Decreasing bin packing, run separately per (profile, material) lot
 * so a bar is only ever cut from pieces that share both.
 */
export function runOptimize1D(pieces: Piece1D[], S: Settings1D): Result1D {
  const skip: string[] = [];
  const usable = usableBarLength(S);
  const bars: Bar[] = [];

  const lots = new Map<string, Piece1D[]>();
  for (const p of pieces) {
    if (!p.qty) continue;
    const key = `${p.profile}\u0000${p.material}`;
    if (!lots.has(key)) lots.set(key, []);
    const arr = lots.get(key)!;
    for (let i = 0; i < p.qty; i++) arr.push(p);
  }

  for (const [, items] of lots) {
    const ord = items.slice().sort((a, b) => b.length - a.length);
    const lotBars: { cuts: Cut[]; free: number }[] = [];
    for (const p of ord) {
      if (p.length > usable + 1e-6) {
        skip.push(`Part #${p.sn} (${p.name}) is ${Math.round(p.length)} mm long — longer than the usable bar length ${Math.round(usable)} mm`);
        continue;
      }
      // Fit into the bar with the smallest sufficient remaining space (best-fit decreasing).
      let best: { cuts: Cut[]; free: number } | null = null;
      for (const b of lotBars) {
        const need = p.length + (b.cuts.length ? S.kerf : 0);
        if (need <= b.free + 1e-6 && (!best || b.free < best.free)) best = b;
      }
      if (best) {
        const need = p.length + (best.cuts.length ? S.kerf : 0);
        const pos = usable - best.free + (best.cuts.length ? S.kerf : 0);
        best.cuts.push({ piece: p, pos });
        best.free -= need;
      } else {
        const b = { cuts: [{ piece: p, pos: 0 }], free: usable - p.length };
        lotBars.push(b);
      }
    }
    for (const b of lotBars) {
      const first = b.cuts[0]?.piece;
      bars.push({ profile: first?.profile ?? "", material: first?.material ?? "", cuts: b.cuts });
    }
  }

  return { bars, skip };
}

/** Total length used by the cuts on a bar (last cut's end), in mm. */
export function barUsedLength(b: Bar): number {
  let end = 0;
  for (const c of b.cuts) end = Math.max(end, c.pos + c.piece.length);
  return end;
}

export function barStats(b: Bar, S: Settings1D) {
  const used = barUsedLength(b);
  const L = b.length ?? S.barLength;
  const usable = Math.max(0, L - 2 * S.endTrim);
  return {
    pieces: b.cuts.length,
    usedLength: Math.round(used),
    scrap: Math.max(0, Math.round(usable - used)),
    utilization: L > 0 ? (100 * b.cuts.reduce((s, c) => s + c.piece.length, 0)) / L : 0,
  };
}

/** Smallest physical bar length this bar can be trimmed to without cutting into its pieces. */
export function minBarLength(b: Bar, S: Settings1D): number {
  return Math.round(barUsedLength(b) + 2 * S.endTrim);
}

/**
 * Trims (or restores) a bar's physical length, e.g. to buy/cut a shorter stock
 * bar for a partly-used bar and reduce scrap. Clamped between the minimum
 * needed to hold its cuts and the stock bar length (S.barLength).
 * Returns the length actually applied.
 */
export function resizeBar(b: Bar, S: Settings1D, length: number): number {
  const min = minBarLength(b, S);
  const L = Math.min(S.barLength, Math.max(min, Math.round(length)));
  b.length = L;
  return L;
}

/** Plain-text cut list, one line per bar, e.g. for printing or pasting into a saw's controller. */
export function buildCutList(bars: Bar[], S: Settings1D): string {
  const lines: string[] = [];
  bars.forEach((b, i) => {
    const L = b.length ?? S.barLength;
    const head = `Bar ${i + 1}${b.profile ? ` — ${b.profile}` : ""}${b.material ? ` — ${b.material}` : ""} (${Math.round(L)} mm)`;
    lines.push(head);
    b.cuts
      .slice()
      .sort((a, b2) => a.pos - b2.pos)
      .forEach((c) => lines.push(`  #${c.piece.sn} ${c.piece.name} — ${Math.round(c.piece.length)} mm @ ${Math.round(c.pos)} mm`));
  });
  return lines.join("\n");
}

/** CSV cut list, one row per cut. */
export function buildCutListCsv(bars: Bar[], S: Settings1D): string {
  const rows = ["Bar,Profile,Material,Bar length (mm),Part #,Part name,Cut length (mm),Position (mm)"];
  bars.forEach((b, i) => {
    const L = b.length ?? S.barLength;
    b.cuts
      .slice()
      .sort((a, b2) => a.pos - b2.pos)
      .forEach((c) => {
        rows.push(
          [i + 1, b.profile, b.material, Math.round(L), c.piece.sn, c.piece.name, Math.round(c.piece.length), Math.round(c.pos)]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(","),
        );
      });
  });
  return rows.join("\n");
}