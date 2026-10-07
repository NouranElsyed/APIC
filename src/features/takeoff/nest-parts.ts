// Parts of a saved DXF Nesting workspace -> plates of Standard Calculations.
//
// The nesting tool stores every part as an outline + holes in mm (see Snapshot2D in nesting/nest-boost/persist.ts).
// Standard Calculations creates a plate from a DXF file, reading its size, net area and cut-outs, and keeps that file
// with the part — so a nest part is turned into a one-part DXF and goes through the same importer as any other DXF.
// Pure functions only (no React, no fetch), so they are easy to test.

export type NestPt = [number, number];

export interface NestPart {
  /** Id of the part inside the nest (stable while the nest is open). */
  id: number;
  name: string;
  qty: number;
  /** Plate thickness in mm, 0 = unknown. */
  th: number;
  material: string;
  outer: NestPt[];
  holes: NestPt[][];
  /** Bounding box in mm. */
  w: number;
  h: number;
  /** Net area in mm² (outline minus holes). */
  area: number;
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isLoop = (v: unknown): v is NestPt[] =>
  Array.isArray(v) && v.length >= 3 && v.every((p) => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]));

const shoelace = (l: NestPt[]) => {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const p = l[i];
    const q = l[(i + 1) % l.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
};

/** The 2D parts of a nesting snapshot (`data` of /api/nesting/workspace). Anything that is not a usable part is skipped. */
export function parseNestParts(data: unknown): NestPart[] {
  const groups = (data as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  const out: NestPart[] = [];
  for (const g of groups as Record<string, unknown>[]) {
    if (!g || typeof g !== "object") continue;
    if (g.cid != null) continue; // a paired-triangle copy, not a part of its own
    if (!isNum(g.id) || !isLoop(g.outer)) continue;
    const qty = isNum(g.qty) ? Math.round(g.qty) : 0;
    if (qty <= 0) continue;
    const holes = Array.isArray(g.holes) ? (g.holes as unknown[]).filter(isLoop) : [];
    const xs = g.outer.map((p) => p[0]);
    const ys = g.outer.map((p) => p[1]);
    out.push({
      id: g.id,
      name: typeof g.name === "string" && g.name.trim() ? g.name.trim() : `Part ${g.id}`,
      qty,
      th: isNum(g.th) && g.th > 0 ? g.th : 0,
      material: typeof g.material === "string" ? g.material.trim() : "",
      outer: g.outer.map((p) => [p[0], p[1]] as NestPt),
      holes: holes.map((h) => h.map((p) => [p[0], p[1]] as NestPt)),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
      area: shoelace(g.outer) - holes.reduce((t, h) => t + shoelace(h), 0),
    });
  }
  return out;
}

/**
 * Row name of the plate. Parts of one DXF all carry the file name ("8.dxf"), so the size is added to tell them apart —
 * unless the name already shows a size (a part typed in by hand is called e.g. "Rectangle 500×300").
 */
export function nestPartDescription(p: Pick<NestPart, "name" | "w" | "h">): string {
  const base = p.name.replace(/\.dxf$/i, "").trim() || "Part";
  if (/[×x]\s*\d/i.test(base) && /\d\s*[×x]/i.test(base)) return base;
  return `${base} ${Math.round(p.w)}×${Math.round(p.h)}`;
}

/** File name for the part's DXF (no characters a file system dislikes). */
export const nestPartFileName = (p: Pick<NestPart, "name" | "w" | "h">) =>
  `${nestPartDescription(p).replace(/[\\/:*?"<>|]+/g, "-")}.dxf`;

/** One part as a stand-alone DXF: closed LWPOLYLINEs in mm, moved to 0,0 (same layout the server writes for a cut-out part). */
export function nestPartToDxf(p: Pick<NestPart, "outer" | "holes">): string {
  const minX = Math.min(...p.outer.map((q) => q[0]));
  const minY = Math.min(...p.outer.map((q) => q[1]));
  const lines: (string | number)[] = [0, "SECTION", 2, "HEADER", 9, "$INSUNITS", 70, 4, 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES"];
  for (const loop of [p.outer, ...p.holes]) {
    lines.push(0, "LWPOLYLINE", 8, "0", 90, loop.length, 70, 1);
    for (const q of loop) lines.push(10, +(q[0] - minX).toFixed(4), 20, +(q[1] - minY).toFixed(4));
  }
  lines.push(0, "ENDSEC", 0, "EOF");
  return lines.join("\n") + "\n";
}
