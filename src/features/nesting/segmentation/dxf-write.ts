/**
 * Segmentation Phase 8 — DXF output (pure strings).
 *
 * Same dialect as the app's own exporter (`buildDxf` in nest-boost/engine.ts): DXF R12 (AC1009),
 * units mm, POLYLINE/VERTEX and CIRCLE. Arcs are real arcs: a polyline vertex that starts an arc
 * carries a bulge (group 42, tan(sweep/4)), and a loop that is one full circle is written as a
 * CIRCLE. Nothing is polygonised, so what is cut equals the exact geometry shown in the preview.
 *
 * Two kinds of drawing:
 *  - a PIECE file: the CUT geometry of one segment moved to the origin (like an imported part, so
 *    its coordinates equal those of the part created in the nest). Only layer CUT by default.
 *  - the ASSEMBLY drawing: the original outline, every finished segment where it belongs, the cut
 *    outlines when an overlap / gap makes them differ, the seams and the labels, on separate layers.
 */
import { loopBBox, regionBBox, regionInteriorPoint } from "./geometry";
import type { Plan, Segment } from "./planner";
import { seamLines } from "./preview-path";
import type { Loop, Pt, Region } from "./types";

export interface DxfLayer {
  name: string;
  /** AutoCAD colour index. */
  color: number;
}

export const LAYER = {
  cut: { name: "CUT", color: 7 },
  finished: { name: "FINISHED", color: 3 },
  label: { name: "LABEL", color: 5 },
  original: { name: "ORIGINAL", color: 7 },
  segments: { name: "SEGMENTS", color: 3 },
  cutOutline: { name: "CUT_GEOMETRY", color: 1 },
  seams: { name: "SEAMS", color: 2 },
  labels: { name: "LABELS", color: 5 },
} satisfies Record<string, DxfLayer>;

/** Number with at most `d` decimals, no exponent and no "-0". */
function num(v: number, d = 4): string {
  const r = Math.round(v * 10 ** d) / 10 ** d;
  return Object.is(r, -0) || r === 0 ? "0" : r.toFixed(d).replace(/\.?0+$/, "");
}

/**
 * A DXF TEXT value: single line, ASCII only. DXF R12 has no UTF-8, so a character outside ASCII (an Arabic part
 * name, "×", "−" …) is written as the \U+XXXX escape CAD programs understand.
 */
export function dxfText(t: string): string {
  let out = "";
  for (const ch of t.replace(/[\r\n\t\u0000-\u001f]+/g, " ").trim()) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 32 && cp < 127) out += ch;
    else if (cp < 0x10000) out += `\\U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    else {
      const v = cp - 0x10000;
      for (const u of [0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff)]) out += `\\U+${u.toString(16).toUpperCase()}`;
    }
  }
  return out;
}

export function dxfDocument(layers: DxfLayer[], entities: string[]): string {
  let s = "0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n";
  s += "0\nSECTION\n2\nTABLES\n";
  s += "0\nTABLE\n2\nLTYPE\n70\n1\n0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0\n0\nENDTAB\n";
  s += `0\nTABLE\n2\nLAYER\n70\n${layers.length}\n`;
  for (const l of layers) s += `0\nLAYER\n2\n${l.name}\n70\n0\n62\n${l.color}\n6\nCONTINUOUS\n`;
  s += "0\nENDTAB\n0\nENDSEC\n";
  s += `0\nSECTION\n2\nENTITIES\n${entities.join("")}0\nENDSEC\n0\nEOF\n`;
  return s;
}

/** The circle a loop is made of, if the whole loop is one circle (one full arc or arcs of one circle). */
export function loopCircle(loop: Loop): { c: Pt; r: number } | null {
  if (!loop.length || loop.some((e) => !e.arc)) return null;
  const a = loop[0].arc!;
  let total = 0;
  for (const e of loop) {
    const arc = e.arc!;
    if (Math.hypot(arc.c[0] - a.c[0], arc.c[1] - a.c[1]) > 1e-6 || Math.abs(arc.r - a.r) > 1e-6 || Math.sign(arc.sweep) !== Math.sign(a.sweep)) return null;
    total += Math.abs(arc.sweep);
  }
  return Math.abs(total - 2 * Math.PI) < 1e-6 ? { c: a.c, r: a.r } : null;
}

/** One closed loop: a CIRCLE if it is a full circle, otherwise a closed POLYLINE whose arc edges carry bulges. */
export function loopEntity(loop: Loop, layer: string, off: Pt = [0, 0]): string {
  const circ = loopCircle(loop);
  if (circ) {
    return `0\nCIRCLE\n8\n${layer}\n10\n${num(circ.c[0] + off[0])}\n20\n${num(circ.c[1] + off[1])}\n30\n0\n40\n${num(circ.r)}\n`;
  }
  let s = `0\nPOLYLINE\n8\n${layer}\n66\n1\n70\n1\n`;
  for (const e of loop) {
    s += `0\nVERTEX\n8\n${layer}\n10\n${num(e.a[0] + off[0])}\n20\n${num(e.a[1] + off[1])}\n`;
    if (e.arc) s += `42\n${num(Math.tan(e.arc.sweep / 4), 8)}\n`;
  }
  return `${s}0\nSEQEND\n8\n${layer}\n`;
}

export const regionEntities = (region: Region, layer: string, off: Pt = [0, 0]): string[] =>
  [region.outer, ...region.holes].map((l) => loopEntity(l, layer, off));

export const textEntity = (text: string, at: Pt, height: number, layer: string): string =>
  `0\nTEXT\n8\n${layer}\n10\n${num(at[0])}\n20\n${num(at[1])}\n30\n0\n40\n${num(height)}\n1\n${dxfText(text)}\n`;

export const lineEntity = (a: Pt, b: Pt, layer: string): string =>
  `0\nLINE\n8\n${layer}\n10\n${num(a[0])}\n20\n${num(a[1])}\n30\n0\n11\n${num(b[0])}\n21\n${num(b[1])}\n31\n0\n`;

/** Where the cut geometry of a segment sits in the original's coordinate system (its bounding-box corner). */
export function cutOrigin(seg: Segment): Pt {
  const b = loopBBox(seg.cut.outer);
  return [b[0], b[1]];
}
export function finishedOrigin(seg: Segment): Pt {
  const b = loopBBox(seg.finished.outer);
  return [b[0], b[1]];
}

export interface PieceDxfOptions {
  /** Also write the finished outline (layer FINISHED) and the segment label (layer LABEL). Off by default: cutting software cuts every layer. */
  annotations?: boolean;
  /** Label text (default: the segment id). */
  label?: string;
}

/** DXF of one segment: the CUT geometry at the origin — the same coordinates as the part created in the nest. */
export function segmentDxf(seg: Segment, opts: PieceDxfOptions = {}): string {
  const o = cutOrigin(seg);
  const off: Pt = [-o[0], -o[1]];
  const ents = regionEntities(seg.cut, LAYER.cut.name, off);
  const layers: DxfLayer[] = [LAYER.cut];
  if (opts.annotations) {
    layers.push(LAYER.finished, LAYER.label);
    if (seg.cut !== seg.finished) ents.push(...regionEntities(seg.finished, LAYER.finished.name, off));
    const p = regionInteriorPoint(seg.cut);
    const b = loopBBox(seg.cut.outer);
    const h = Math.max(Math.min(b[2] - b[0], b[3] - b[1]) / 12, 2);
    if (p) ents.push(textEntity(opts.label ?? seg.id, [p[0] + off[0], p[1] + off[1]], h, LAYER.label.name));
  }
  return dxfDocument(layers, ents);
}

export interface AssemblyDxfInput {
  original: Region;
  plan: Plan;
  /** Title lines written under the drawing. */
  title: string[];
}

/** Reference drawing: how the finished segments reconstruct the original, with seams and labels. */
export function assemblyDxf(a: AssemblyDxfInput): string {
  const [x0, y0, x1, y1] = regionBBox(a.original);
  const size = Math.max(x1 - x0, y1 - y0, 1);
  const h = Math.max(size / 70, 2);
  const ents: string[] = [...regionEntities(a.original, LAYER.original.name)];
  for (const s of a.plan.segments) ents.push(...regionEntities(s.finished, LAYER.segments.name));
  for (const s of a.plan.segments) if (s.cut !== s.finished) ents.push(...regionEntities(s.cut, LAYER.cutOutline.name));
  for (const m of a.plan.seams) for (const l of seamLines(m)) ents.push(lineEntity([l.x1, l.y1], [l.x2, l.y2], LAYER.seams.name));
  for (const s of a.plan.segments) {
    const p = regionInteriorPoint(s.finished);
    if (p) ents.push(textEntity(s.id, [p[0] - h, p[1]], h, LAYER.labels.name));
  }
  const done = new Set<string>();
  for (const m of a.plan.seams) {
    if (done.has(m.cutId)) continue; // one label per cut line, at the start of its first seam
    done.add(m.cutId);
    const l = seamLines(m)[0];
    if (l) ents.push(textEntity(m.cutId, [l.x1, l.y1], h * 0.8, LAYER.labels.name));
  }
  a.title.forEach((t, i) => ents.push(textEntity(t, [x0, y0 - h * (2.5 + 1.8 * i)], h, LAYER.labels.name)));
  return dxfDocument([LAYER.original, LAYER.segments, LAYER.cutOutline, LAYER.seams, LAYER.labels], ents);
}
