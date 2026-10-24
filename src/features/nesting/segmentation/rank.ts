/**
 * Segmentation Phase 7 — ranking and explaining candidate layouts (pure).
 *
 * Only MEASURABLE factors are used — no prices, so nothing here claims a cost optimum:
 *   sheets            real sheet count from the nesting engine when the layout was checked,
 *                     otherwise an area lower bound (marked "≈ / ≥");
 *   seam length       total length that has to be joined;
 *   segment count     number of pieces.
 * The user picks which of the three comes first; the other two break ties in a fixed order.
 *
 * Order of the list: layouts checked with the engine (that nest completely) first, then layouts
 * shown with estimates, then layouts the engine could not nest completely, then invalid layouts.
 */
import type { EngineEval } from "./evaluate";
import type { Candidate } from "./planner";

export type Priority = "sheets" | "seams" | "segments";

export const PRIORITY_LABEL: Record<Priority, string> = {
  sheets: "Fewest sheets",
  seams: "Shortest seams",
  segments: "Fewest segments",
};

const PRIORITY_ORDER: Record<Priority, string> = {
  sheets: "fewest sheets, then shortest seams, then fewest segments",
  seams: "shortest seams, then fewest sheets, then fewest segments",
  segments: "fewest segments, then fewest sheets, then shortest seams",
};

export type CandStatus = "ok" | "unnested" | "invalid";

export interface Ranked {
  cand: Candidate;
  /** undefined = not checked yet; null = the check could not be completed. */
  engine: EngineEval | null | undefined;
  status: CandStatus;
  /** Real count (engine) or area lower bound (estimate). */
  sheets: number | null;
  sheetsKind: "engine" | "estimate" | "none";
  /** 1-based position in the list. */
  rank: number;
}

const SEAM_TOL = 1; // mm: seam lengths closer than this count as equal
const num = (v: number | null) => (v === null ? Infinity : v);

function make(c: Candidate, ev: EngineEval | null | undefined): Omit<Ranked, "rank"> {
  const m = c.plan.metrics;
  if (!c.plan.valid) return { cand: c, engine: ev, status: "invalid", sheets: null, sheetsKind: "none" };
  if (ev && ev.unplaced > 0) return { cand: c, engine: ev, status: "unnested", sheets: ev.sheets, sheetsKind: "engine" };
  if (ev) return { cand: c, engine: ev, status: "ok", sheets: ev.sheets, sheetsKind: "engine" };
  return { cand: c, engine: ev, status: "ok", sheets: m.sheetsLowerBound, sheetsKind: m.sheetsLowerBound === null ? "none" : "estimate" };
}

const group = (r: Omit<Ranked, "rank">) => (r.status === "invalid" ? 3 : r.status === "unnested" ? 2 : r.sheetsKind === "engine" ? 0 : 1);

function compare(a: Omit<Ranked, "rank">, b: Omit<Ranked, "rank">, p: Priority): number {
  const ga = group(a);
  const gb = group(b);
  if (ga !== gb) return ga - gb;
  const ma = a.cand.plan.metrics;
  const mb = b.cand.plan.metrics;
  const sheets = num(a.sheets) - num(b.sheets);
  const seams = Math.abs(ma.cutLength - mb.cutLength) < SEAM_TOL ? 0 : ma.cutLength - mb.cutLength;
  const segs = ma.segments - mb.segments;
  const order = p === "sheets" ? [sheets, seams, segs] : p === "seams" ? [seams, sheets, segs] : [segs, sheets, seams];
  for (const d of order) if (d !== 0) return Math.sign(d);
  if (a.engine && b.engine && Math.abs(a.engine.utilization - b.engine.utilization) > 0.05) return b.engine.utilization - a.engine.utilization;
  return a.cand.id.localeCompare(b.cand.id);
}

export function rankCandidates(cands: Candidate[], evals: ReadonlyMap<string, EngineEval | null>, priority: Priority): Ranked[] {
  return cands
    .map((c) => make(c, evals.get(c.id)))
    .sort((a, b) => compare(a, b, priority))
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

const m2 = (v: number) => (Math.round(v / 10) / 100).toFixed(2); // mm → m, 2 decimals
const pc = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1)} %`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** One line about a layout's sheets: the engine's real count or an area estimate. */
export function sheetsText(r: Ranked): string {
  if (r.sheetsKind === "engine" && r.engine) {
    return r.status === "unnested"
      ? `${plural(r.engine.unplaced, "piece")} could not be nested`
      : `${plural(r.engine.sheets, "sheet")} · ${pc(r.engine.utilization)} used`;
  }
  return r.sheets === null ? "—" : `≥ ${plural(r.sheets, "sheet")} (area estimate)`;
}

/** What makes `a` better or worse than `b`, from a's point of view. Equal factors are left out. */
export function differences(a: Ranked, b: Ranked): { text: string; better: boolean }[] {
  const out: { text: string; better: boolean }[] = [];
  const ma = a.cand.plan.metrics;
  const mb = b.cand.plan.metrics;
  if (a.sheets !== null && b.sheets !== null && a.sheetsKind === b.sheetsKind && a.sheets !== b.sheets) {
    const d = Math.abs(a.sheets - b.sheets);
    const how = a.sheetsKind === "engine" ? "checked with the nesting engine" : "area estimates";
    out.push({ better: a.sheets < b.sheets, text: `${plural(d, "sheet")} ${a.sheets < b.sheets ? "fewer" : "more"} (${a.sheets} vs ${b.sheets}, ${how})` });
  } else if (a.sheetsKind !== b.sheetsKind && a.sheetsKind !== "none" && b.sheetsKind !== "none") {
    out.push({ better: true, text: "sheet counts are not comparable: one is a real engine result, the other an area estimate" });
  }
  if (a.engine && b.engine && a.status !== "invalid" && b.status !== "invalid" && Math.abs(a.engine.utilization - b.engine.utilization) >= 0.5) {
    out.push({ better: a.engine.utilization > b.engine.utilization, text: `${pc(a.engine.utilization)} of the sheet area used vs ${pc(b.engine.utilization)}` });
  }
  if (Math.abs(ma.cutLength - mb.cutLength) >= 10) {
    const d = Math.abs(ma.cutLength - mb.cutLength);
    out.push({ better: ma.cutLength < mb.cutLength, text: `${m2(d)} m ${ma.cutLength < mb.cutLength ? "shorter" : "longer"} seams (${m2(ma.cutLength)} vs ${m2(mb.cutLength)} m)` });
  }
  if (ma.segments !== mb.segments) {
    const d = Math.abs(ma.segments - mb.segments);
    out.push({ better: ma.segments < mb.segments, text: `${plural(d, "segment")} ${ma.segments < mb.segments ? "fewer" : "more"} (${ma.segments} vs ${mb.segments})` });
  }
  if (ma.soloSegments !== mb.soloSegments) {
    out.push({ better: ma.soloSegments < mb.soloSegments, text: `${ma.soloSegments} margin-free (solo) segments vs ${mb.soloSegments}` });
  }
  return out;
}

export interface Explanation {
  headline: string;
  bullets: string[];
  limits: string[];
}

/** Why the list is in this order, and what it does not mean. */
export function explainOrder(ranked: Ranked[], priority: Priority, engineSeconds?: number): Explanation {
  const ok = ranked.filter((r) => r.status === "ok");
  const bullets: string[] = [];
  const top = ranked[0];
  if (top && top.status !== "invalid") {
    const m = top.cand.plan.metrics;
    bullets.push(`#1 is “${top.cand.label}”: ${sheetsText(top)}, ${plural(m.segments, "segment")}, ${m2(m.cutLength)} m of seams.`);
    const next = ranked[1];
    if (next && next.status !== "invalid") {
      const d = differences(top, next);
      if (d.length) bullets.push(`Compared with #2: ${d.map((x) => x.text).join("; ")}.`);
      else bullets.push("#2 is equal to #1 on every measured factor; it is listed after it only by name.");
    }
    // the best layout on each of the other factors, when it is not #1
    const sameKind = ok.filter((r) => r.sheetsKind === top.sheetsKind);
    const best = (key: (r: Ranked) => number) => sameKind.reduce((b, r) => (key(r) < key(b) ? r : b), sameKind[0]);
    const picks: [string, Ranked | undefined][] = [
      ["Shortest seams", sameKind.length ? best((r) => r.cand.plan.metrics.cutLength) : undefined],
      ["Fewest segments", sameKind.length ? best((r) => r.cand.plan.metrics.segments) : undefined],
    ];
    for (const [name, r] of picks) {
      if (!r || r === top) continue;
      const d = differences(r, top);
      const tied = name === "Shortest seams" ? Math.abs(r.cand.plan.metrics.cutLength - top.cand.plan.metrics.cutLength) < 10 : r.cand.plan.metrics.segments === top.cand.plan.metrics.segments;
      if (!tied) bullets.push(`${name}: #${r.rank} “${r.cand.label}” — ${d.length ? d.map((x) => x.text).join("; ") : "see the comparison"}.`);
    }
  }
  const unchecked = ranked.filter((r) => r.status === "ok" && r.sheetsKind === "estimate").length;
  const failed = ranked.filter((r) => r.status === "unnested").length;
  const limits = [
    "No prices are used, so this order is not a cost optimum — it ranks measurable factors only (sheets, seam length, segment count).",
    "Each layout is nested on its own, not mixed with the other parts of your nest.",
  ];
  if (unchecked) limits.unshift(`${plural(unchecked, "layout")} still show area estimates (≥): they are lower bounds, not what the engine achieves. Use “Check with nesting engine”.`);
  if (ranked.some((r) => r.sheetsKind === "engine")) {
    limits.push(`Engine results come from a short randomised run${engineSeconds ? ` (${engineSeconds} s per layout)` : ""}; in close cases another run can differ by a sheet.`);
  }
  if (failed) limits.push(`${plural(failed, "layout")} could not be nested completely by the engine and are listed after the others.`);
  return { headline: `Ordered by ${PRIORITY_ORDER[priority]}.`, bullets, limits };
}

/* ------------------------------------------------------------------ */
/* Side-by-side comparison                                             */
/* ------------------------------------------------------------------ */

export interface CompareRow {
  label: string;
  cells: string[];
  /** Indexes of the best value(s) in this row, or [] when no value is "better". */
  best: number[];
}

const bestOf = (vals: (number | null)[], dir: "low" | "high"): number[] => {
  const ok = vals.filter((v): v is number => v !== null);
  if (ok.length < 2) return [];
  const t = dir === "low" ? Math.min(...ok) : Math.max(...ok);
  if (ok.every((v) => v === t)) return [];
  return vals.map((v, i) => (v !== null && v === t ? i : -1)).filter((i) => i >= 0);
};

export function compareRows(rs: Ranked[]): CompareRow[] {
  const kinds = new Set(rs.map((r) => r.sheetsKind));
  const sameKind = kinds.size === 1;
  const largest = (r: Ranked) => {
    let w = 0;
    let h = 0;
    for (const s of r.cand.plan.segments) {
      const a = s.bbox[2] - s.bbox[0];
      const b = s.bbox[3] - s.bbox[1];
      if (a * b > w * h) {
        w = a;
        h = b;
      }
    }
    return `${Math.round(w)} × ${Math.round(h)}`;
  };
  const eng = rs.map((r) => (r.engine && r.engine.unplaced === 0 ? r.engine : null));
  return [
    {
      label: "Sheets",
      cells: rs.map((r) => (r.sheets === null ? "—" : r.sheetsKind === "engine" ? String(r.sheets) : `≥ ${r.sheets}`)),
      best: sameKind ? bestOf(rs.map((r) => r.sheets), "low") : [],
    },
    { label: "Sheet area used", cells: eng.map((e) => (e ? pc(e.utilization) : "—")), best: bestOf(eng.map((e) => (e ? e.utilization : null)), "high") },
    { label: "Scrap", cells: eng.map((e) => (e ? pc(e.scrapPct) : "—")), best: bestOf(eng.map((e) => (e ? e.scrapPct : null)), "low") },
    { label: "Segments", cells: rs.map((r) => String(r.cand.plan.metrics.segments)), best: bestOf(rs.map((r) => r.cand.plan.metrics.segments), "low") },
    { label: "Seam length (m)", cells: rs.map((r) => m2(r.cand.plan.metrics.cutLength)), best: bestOf(rs.map((r) => Math.round(r.cand.plan.metrics.cutLength / SEAM_TOL)), "low") },
    { label: "Solo segments", cells: rs.map((r) => String(r.cand.plan.metrics.soloSegments)), best: bestOf(rs.map((r) => r.cand.plan.metrics.soloSegments), "low") },
    { label: "Largest piece (mm)", cells: rs.map(largest), best: [] },
  ];
}
