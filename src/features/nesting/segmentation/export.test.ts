import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseDXF, type Pt } from "../nest-boost/engine";
import { buildBundle, safeFileName } from "./bundle";
import { assemblyDxf, cutOrigin, dxfDocument, dxfText, loopCircle, loopEntity, regionEntities, segmentDxf, textEntity } from "./dxf-write";
import { circleLoop, loopArea, loopBBox, loopFromBulge, regionArea, regionBBox, regionFromPolygon, regionRings, ringsContain, ringsDistance } from "./geometry";
import { recoverArcs } from "./group-region";
import { generateCandidates, type Plan, type OverlapSpec, type GenSettings } from "./planner";
import { appliedAt, overlapText, reportData, segmentationWorkbook } from "./report";
import type { Edge, Loop, Region } from "./types";
import { buildZip, crc32 } from "./zip";

/* ---------------- helpers ---------------- */

const rect = (w: number, h: number): Pt[] => [[0, 0], [w, 0], [w, h], [0, h]];
const SHEET = { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2, gp: 5, cell: 5 };
const NO: OverlapSpec = { enabled: false, mm: 0, side: "A" };
const gen = (overlap: OverlapSpec = NO, over: Partial<GenSettings> = {}): GenSettings => ({
  directions: ["H", "V"], sheet: SHEET, overlap, holePolicy: "reject", allowSolo: false, ...over,
});
const best = (region: Region, overlap: OverlapSpec = NO): Plan => {
  const c = generateCandidates(region, gen(overlap)).find((x) => x.plan.valid);
  if (!c) throw new Error("no valid layout");
  return c.plan;
};
const circle: Region = { outer: circleLoop(0, 0, 3760), holes: [] };
const plate = regionFromPolygon(rect(12000, 2980));
const parent = (name = "PLATE-001", qty = 3) => ({ name, qty, th: 10, material: "S235", w: 7520, h: 7520, area: 1 });

/** Raw DXF → entities with their layer, type and vertex list (for structural checks). */
function readDxf(dxf: string) {
  const lines = dxf.split("\n");
  expect(lines[lines.length - 1]).toBe(""); // ends with a newline
  lines.pop();
  expect(lines.length % 2).toBe(0);
  const pairs: [number, string][] = [];
  for (let i = 0; i < lines.length; i += 2) {
    expect(lines[i]).toMatch(/^\s*-?\d+$/);
    pairs.push([Number(lines[i]), lines[i + 1]]);
  }
  const ents: { type: string; layer: string; d: [number, string][]; verts: { x: number; y: number; bulge: number }[] }[] = [];
  let sec = "";
  let cur: (typeof ents)[number] | null = null;
  let vert: { x: number; y: number; bulge: number } | null = null;
  for (const [c, v] of pairs) {
    if (c === 0) {
      if (v === "SECTION") sec = "?";
      cur = null;
      if (sec === "ENTITIES" && !["ENDSEC", "VERTEX", "SEQEND", "EOF"].includes(v)) {
        cur = { type: v, layer: "", d: [], verts: [] };
        ents.push(cur);
      }
      if (sec === "ENTITIES" && v === "VERTEX") {
        vert = { x: NaN, y: NaN, bulge: 0 };
        ents[ents.length - 1].verts.push(vert);
      } else vert = null;
      continue;
    }
    if (c === 2 && sec === "?") sec = v;
    else if (sec === "ENTITIES") {
      if (vert) {
        if (c === 10) vert.x = Number(v);
        if (c === 20) vert.y = Number(v);
        if (c === 42) vert.bulge = Number(v);
      } else if (cur) {
        cur.d.push([c, v]);
        if (c === 8) cur.layer = v;
      }
    }
  }
  return { pairs, ents, text: dxf };
}
const get = (e: { d: [number, string][] }, code: number) => Number(e.d.find(([c]) => c === code)?.[1]);

/** Re-import with the app's own parser, then rebuild the arcs (what the nest sees). */
function reimport(dxf: string): Region {
  const { loops } = parseDXF(dxf);
  expect(loops.length).toBeGreaterThan(0);
  const rec = loops.map((l) => recoverArcs(l).loop);
  const outer = rec.reduce((b, l) => (Math.abs(loopArea(l)) > Math.abs(loopArea(b)) ? l : b), rec[0]);
  return { outer: loopArea(outer) > 0 ? outer : outer.slice().reverse().map((e): Edge => ({ a: e.b, b: e.a, ...(e.arc ? { arc: { c: e.arc.c, r: e.arc.r, a0: e.arc.a0 + e.arc.sweep, sweep: -e.arc.sweep } } : {}) })), holes: [] };
}

const translate = (l: Loop, dx: number, dy: number): Loop =>
  l.map((e) => ({ a: [e.a[0] + dx, e.a[1] + dy], b: [e.b[0] + dx, e.b[1] + dy], ...(e.arc ? { arc: { ...e.arc, c: [e.arc.c[0] + dx, e.arc.c[1] + dy] as Pt } } : {}) }));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- DXF writer ---------------- */

describe("dxf writer", () => {
  it("writes a well-formed R12 document with units and layers", () => {
    const d = dxfDocument([{ name: "CUT", color: 7 }, { name: "SEAMS", color: 2 }], [loopEntity(regionFromPolygon(rect(10, 5)).outer, "CUT")]);
    const r = readDxf(d);
    expect(d.startsWith("0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n")).toBe(true);
    expect(d.endsWith("0\nENDSEC\n0\nEOF\n")).toBe(true);
    expect(r.pairs.filter(([c, v]) => c === 0 && v === "LAYER")).toHaveLength(2);
    expect(r.pairs.some(([c, v]) => c === 2 && v === "SEAMS")).toBe(true);
    expect(r.ents.map((e) => e.type)).toEqual(["POLYLINE"]);
  });

  it("a polygon is a closed POLYLINE without bulges", () => {
    const e = readDxf(dxfDocument([], [loopEntity(regionFromPolygon(rect(10, 5)).outer, "CUT")])).ents[0];
    expect(get(e, 70)).toBe(1);
    expect(e.verts).toHaveLength(4);
    expect(e.verts.every((v) => v.bulge === 0)).toBe(true);
    expect(e.verts[2]).toMatchObject({ x: 10, y: 5 });
  });

  it("an arc edge carries its bulge, tan(sweep / 4), and the arc is not polygonised", () => {
    const loop = loopFromBulge([[0, 0, 0], [100, 0, 0.5], [100, 100, 0]]);
    const e = readDxf(dxfDocument([], [loopEntity(loop, "CUT")])).ents[0];
    expect(e.verts).toHaveLength(3); // three vertices, not dozens
    expect(e.verts.map((v) => v.bulge)).toEqual([0, 0.5, 0]);
    const q = loopFromBulge([[0, 0, 1], [10, 0, 0]]); // half circle: bulge 1 (sweep π)
    expect(readDxf(dxfDocument([], [loopEntity(q, "CUT")])).ents[0].verts[0].bulge).toBe(1);
  });

  it("a full circle (one edge or two half arcs, either direction) is a CIRCLE entity", () => {
    for (const ccw of [true, false]) {
      const loop = circleLoop(10.5, -20.25, 7.5, ccw);
      expect(loopCircle(loop)).toMatchObject({ r: 7.5 });
      const e = readDxf(dxfDocument([], [loopEntity(loop, "CUT")])).ents[0];
      expect(e.type).toBe("CIRCLE");
      expect([get(e, 10), get(e, 20), get(e, 40)]).toEqual([10.5, -20.25, 7.5]);
    }
    const one: Loop = [{ a: [5, 0], b: [5, 0], arc: { c: [0, 0], r: 5, a0: 0, sweep: 2 * Math.PI } }];
    expect(loopCircle(one)).toMatchObject({ r: 5 });
    expect(loopCircle(circleLoop(0, 0, 5).slice(0, 1))).toBeNull(); // half a circle is not a circle
  });

  it("a region with a circular hole: outline as POLYLINE, hole as CIRCLE", () => {
    const region: Region = { outer: regionFromPolygon(rect(100, 50)).outer, holes: [circleLoop(50, 25, 10, false)] };
    const ents = readDxf(dxfDocument([], regionEntities(region, "CUT"))).ents;
    expect(ents.map((e) => e.type)).toEqual(["POLYLINE", "CIRCLE"]);
  });

  it("numbers have no exponent and no negative zero", () => {
    const d = dxfDocument([], [loopEntity(translate(regionFromPolygon(rect(1e-9, 5)).outer, -1e-9, 0), "CUT", [0, 0])]);
    expect(d).not.toMatch(/e[+-]\d/i);
    expect(d).not.toContain("-0\n");
  });

  it("text is single-line ASCII; other characters become \\U+XXXX escapes", () => {
    expect(dxfText("PLATE-001 S01")).toBe("PLATE-001 S01");
    expect(dxfText("a\nb\r\tc")).toBe("a b c");
    expect(dxfText("2×3 − 1")).toBe("2\\U+00D73 \\U+2212 1");
    expect(dxfText("لوح")).toBe("\\U+0644\\U+0648\\U+062D");
    expect(dxfText("😀")).toBe("\\U+D83D\\U+DE00");
    expect(textEntity("x", [1, 2], 3, "L")).toBe("0\nTEXT\n8\nL\n10\n1\n20\n2\n30\n0\n40\n3\n1\nx\n");
    for (const l of dxfText("لوح ×").split("\n")) expect(l).toMatch(/^[\x20-\x7e]*$/);
  });
});

/* ---------------- a piece file ---------------- */

describe("segment (piece) DXF", () => {
  const plan = best(circle);

  it("holds only the CUT geometry, moved to the origin", () => {
    for (const s of plan.segments) {
      const dxf = segmentDxf(s);
      const { ents } = readDxf(dxf);
      expect(new Set(ents.map((e) => e.layer))).toEqual(new Set(["CUT"]));
      // the lower-left corner of the EXACT outline is at (0,0); with arcs it can lie on an arc, not on a vertex
      const [x0, y0] = regionBBox(reimport(dxf));
      expect(x0).toBeCloseTo(0, 3);
      expect(y0).toBeCloseTo(0, 3);
      const [ox, oy] = cutOrigin(s);
      expect(ox).toBeCloseTo(loopBBox(s.cut.outer)[0], 9);
      expect(oy).toBeCloseTo(loopBBox(s.cut.outer)[1], 9);
    }
  });

  it("round-trips through the app's own DXF parser with true arcs and the exact area", () => {
    for (const s of plan.segments) {
      const back = reimport(segmentDxf(s));
      expect(back.outer.some((e) => e.arc)).toBe(s.cut.outer.some((e) => e.arc)); // arcs stay arcs
      expect(Math.abs(regionArea(back) - s.cutArea)).toBeLessThan(s.cutArea * 1e-6 + 1e-3);
      const [x0, y0, x1, y1] = regionBBox(back);
      const [o0, p0, o1, p1] = loopBBox(s.cut.outer);
      expect(x1 - x0).toBeCloseTo(o1 - o0, 2); // coordinates are written with 4 decimals
      expect(y1 - y0).toBeCloseTo(p1 - p0, 2);
    }
    const arcRadii = plan.segments.flatMap((s) => reimport(segmentDxf(s)).outer.filter((e) => e.arc).map((e) => e.arc!.r));
    expect(arcRadii.length).toBeGreaterThan(0);
    for (const r of arcRadii) expect(r).toBeCloseTo(3760, 2); // the original radius, not an approximation
  });

  it("a full circle piece round-trips as a CIRCLE", () => {
    const disc = best({ outer: circleLoop(0, 0, 600), holes: [] }); // fits: one segment, a whole circle
    expect(disc.segments).toHaveLength(1);
    const dxf = segmentDxf(disc.segments[0]);
    expect(readDxf(dxf).ents.map((e) => e.type)).toEqual(["CIRCLE"]);
    const back = reimport(dxf);
    expect(back.outer.every((e) => e.arc && Math.abs(e.arc.r - 600) < 1e-3)).toBe(true);
  });

  it("annotations (finished outline + label) go on separate layers and are off by default", () => {
    const withGap = best(circle, { enabled: true, mm: -6, side: "A" });
    const s = withGap.segments.find((x) => x.cut !== x.finished)!;
    expect(new Set(readDxf(segmentDxf(s)).ents.map((e) => e.layer))).toEqual(new Set(["CUT"]));
    const a = readDxf(segmentDxf(s, { annotations: true, label: "PART-S02" }));
    expect(new Set(a.ents.map((e) => e.layer))).toEqual(new Set(["CUT", "FINISHED", "LABEL"]));
    expect(a.ents.filter((e) => e.type === "TEXT")).toHaveLength(1);
    // the finished outline is drawn in the piece's own frame (cut origin), so it surrounds the cut outline
    const fin = a.ents.filter((e) => e.layer === "FINISHED").flatMap((e) => e.verts.map((v) => v.x));
    expect(Math.min(...fin)).toBeLessThanOrEqual(0.001);
    const plain = best(plate).segments[0];
    expect(new Set(readDxf(segmentDxf(plain, { annotations: true })).ents.map((e) => e.layer))).toEqual(new Set(["CUT", "LABEL"])); // cut = finished: no duplicate outline
  });
});

/* ---------------- the assembly drawing ---------------- */

describe("assembly drawing", () => {
  it("has the original, every finished piece, the seams and the labels on their own layers", () => {
    const plan = best(circle);
    const dxf = assemblyDxf({ original: circle, plan, title: ["T1", "T2", "T3"] });
    const { ents } = readDxf(dxf);
    const on = (layer: string) => ents.filter((e) => e.layer === layer);
    expect(on("ORIGINAL").map((e) => e.type)).toEqual(["CIRCLE"]); // the original circle is a real circle
    expect(on("SEGMENTS")).toHaveLength(plan.segments.length);
    expect(on("CUT_GEOMETRY")).toHaveLength(0); // no overlap / gap: nothing different to show
    const lines = on("SEAMS");
    expect(lines.every((e) => e.type === "LINE")).toBe(true);
    expect(lines).toHaveLength(plan.seams.reduce((n, m) => n + m.intervals.length, 0));
    const labels = on("LABELS").filter((e) => e.type === "TEXT").map((e) => e.d.find(([c]) => c === 1)![1]);
    for (const s of plan.segments) expect(labels).toContain(s.id);
    for (const c of new Set(plan.seams.map((m) => m.cutId))) expect(labels).toContain(c);
    expect(labels).toEqual(expect.arrayContaining(["T1", "T2", "T3"]));
  });

  it("shows the cut outlines separately when an overlap or gap makes them differ", () => {
    for (const mm of [30, -6]) {
      const plan = best(circle, { enabled: true, mm, side: "alternate" });
      const ents = readDxf(assemblyDxf({ original: circle, plan, title: [] })).ents;
      expect(ents.filter((e) => e.layer === "CUT_GEOMETRY").length).toBe(plan.segments.filter((s) => s.cut !== s.finished).length);
      expect(ents.filter((e) => e.layer === "CUT_GEOMETRY").length).toBeGreaterThan(0);
    }
  });

  it("the finished pieces drawn in it reconstruct the original exactly (area)", () => {
    const plan = best(circle);
    const ents = readDxf(assemblyDxf({ original: circle, plan, title: [] })).ents.filter((e) => e.layer === "SEGMENTS");
    expect(ents).toHaveLength(plan.segments.length);
    const total = plan.segments.reduce((s, g) => s + g.finishedArea, 0);
    expect(total).toBeCloseTo(regionArea(circle), 3);
  });
});

/* ---------------- zip ---------------- */

/** Reads back a STORE zip: verifies signatures, CRCs and the central directory. */
function readZip(z: Uint8Array) {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const dec = new TextDecoder();
  const eocd = z.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: { name: string; data: Uint8Array; flags: number }[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const flags = v.getUint16(p + 8, true);
    expect(v.getUint16(p + 10, true)).toBe(0); // stored
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(z.subarray(p + 46, p + 46 + nameLen));
    expect(v.getUint32(lho, true)).toBe(0x04034b50);
    const ln = v.getUint16(lho + 26, true);
    const le = v.getUint16(lho + 28, true);
    const data = z.slice(lho + 30 + ln + le, lho + 30 + ln + le + size);
    expect(crc32(data)).toBe(crc);
    expect(v.getUint32(lho + 14, true)).toBe(crc);
    out.push({ name, data, flags });
    p += 46 + nameLen;
  }
  return out;
}

describe("zip", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("stores text, binary, empty files and UTF-8 names, and reads back identically", () => {
    const bin = Uint8Array.from({ length: 1000 }, (_, i) => (i * 37) % 256);
    const z = buildZip([{ name: "a.dxf", data: "0\nEOF\n" }, { name: "لوح-S01.dxf", data: "x" }, { name: "empty.txt", data: "" }, { name: "bin.dat", data: bin }], new Date(2026, 9, 22, 12, 30, 10));
    const r = readZip(z);
    expect(r.map((e) => e.name)).toEqual(["a.dxf", "لوح-S01.dxf", "empty.txt", "bin.dat"]);
    expect(new TextDecoder().decode(r[0].data)).toBe("0\nEOF\n");
    expect(r[2].data).toHaveLength(0);
    expect([...r[3].data]).toEqual([...bin]);
    expect(r.every((e) => (e.flags & 0x0800) !== 0)).toBe(true); // names flagged as UTF-8
  });

  it("an empty zip is valid", () => {
    const z = buildZip([]);
    expect(z).toHaveLength(22);
    expect(readZip(z)).toEqual([]);
  });
});

/* ---------------- report ---------------- */

describe("report data", () => {
  it("describes originals, pieces, assembly positions, seams and mating edges", () => {
    const plan = best(plate);
    const d = reportData({ parent: { name: "PLATE-001", qty: 3, th: 10, material: "S235", w: 12000, h: 2980, area: 12000 * 2980 }, original: plate, plan, generatedAt: "2026-10-22 12:00" });
    const sum = new Map(d.summary);
    expect(sum.get("Original part")).toBe("PLATE-001");
    expect(sum.get("Quantity of originals")).toBe(3);
    expect(sum.get("Segments per original")).toBe(plan.segments.length);
    expect(sum.get("Pieces to nest (segments × quantity)")).toBe(3 * plan.segments.length);
    expect(sum.get("Overlap / gap")).toBe("none");
    expect(sum.get("Reassembly check")).toMatch(/^OK/);
    expect(sum.get("Generated")).toBe("2026-10-22 12:00");
    expect(Math.abs(d.reassemblyDiffMm2)).toBeLessThan(1e-3);

    expect(d.pieces.map((p) => p.name)).toEqual(plan.segments.map((s) => `PLATE-001-${s.id}`));
    expect(d.pieces.every((p) => p.qty === 3 && p.file === `${p.name}.dxf`)).toBe(true);
    // finished pieces tile the plate: their lower-left corners and sizes are consistent with the seams
    const first = d.pieces[0];
    expect([first.finishedX, first.finishedY]).toEqual([0, 0]);
    expect(first.cutX).toBe(first.finishedX); // no overlap / gap
    // every seam is listed from both sides, with the same length and line
    for (const m of d.seams) {
      const a = d.pieces.find((p) => p.id === m.seam.low)!.mating.find((e) => e.seam === m.seam.id)!;
      const b = d.pieces.find((p) => p.id === m.seam.high)!.mating.find((e) => e.seam === m.seam.id)!;
      expect(a.with).toBe(m.seam.high);
      expect(b.with).toBe(m.seam.low);
      expect(a.lengthMm).toBe(b.lengthMm);
      expect(a.line).toBe(b.line);
      expect([a.appliedMm, b.appliedMm]).toEqual([0, 0]);
    }
  });

  it("states the overlap / gap and what each piece gets at each seam", () => {
    expect(overlapText(NO)).toBe("none");
    expect(overlapText({ enabled: true, mm: 50, side: "alternate" })).toBe("Overlap +50 mm (carried by alternating segments)");
    expect(overlapText({ enabled: true, mm: -3, side: "symmetric" })).toBe("Gap -3 mm (cut back on both segments, half each)");
    const seam = { carrier: "low" } as Parameters<typeof appliedAt>[1];
    const o = { enabled: true, mm: 50, side: "A" as const };
    expect([appliedAt(o, seam, "low"), appliedAt(o, seam, "high")]).toEqual([50, 0]);
    expect([appliedAt({ ...o, mm: -8 }, { carrier: "high" } as never, "low"), appliedAt({ ...o, mm: -8 }, { carrier: "high" } as never, "high")]).toEqual([0, -8]);
    expect([appliedAt({ ...o, mm: -8 }, { carrier: "both" } as never, "low"), appliedAt({ ...o, mm: -8 }, { carrier: "both" } as never, "high")]).toEqual([-4, -4]);
    expect(appliedAt(NO, seam, "low")).toBe(0);
  });

  it("a gap shows as cut pieces smaller than finished ones, with the area change", () => {
    const plan = best(plate, { enabled: true, mm: -4, side: "A" });
    const d = reportData({ parent: parent("P", 2), original: plate, plan });
    expect(d.pieces.some((p) => p.areaChangeM2 < 0)).toBe(true);
    // the piece that is cut is shorter than the finished piece by the gap (policy "A": the lower piece is cut back)
    const cutBack = d.pieces.filter((p) => p.cutW < p.finishedW - 1e-6 || p.cutH < p.finishedH - 1e-6);
    expect(cutBack.length).toBeGreaterThan(0);
    for (const p of d.pieces) {
      expect(p.cutW).toBeLessThanOrEqual(p.finishedW + 1e-6);
      expect(p.cutH).toBeLessThanOrEqual(p.finishedH + 1e-6);
    }
    expect(Math.max(...cutBack.map((p) => Math.max(p.finishedW - p.cutW, p.finishedH - p.cutH)))).toBeCloseTo(4, 6);
    expect(new Map(d.summary).get("Overlap / gap")).toMatch(/^Gap -4 mm/);
    expect(Math.abs(d.reassemblyDiffMm2)).toBeLessThan(1e-3); // the FINISHED pieces still tile the part
  });

  it("writes an Excel workbook with the four sheets and the same numbers", async () => {
    const plan = best(plate);
    const wb = segmentationWorkbook({ parent: { name: "لوح PLATE-001", qty: 3, th: 10, material: "S235", w: 12000, h: 2980, area: 1 }, original: plate, plan, generatedAt: "t" });
    const buf = new Uint8Array(await wb.xlsx.writeBuffer());
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(buf as unknown as Parameters<typeof back.xlsx.load>[0]);
    expect(back.worksheets.map((w) => w.name)).toEqual(["Summary", "Segments", "Seams", "Mating edges"]);
    const seg = back.getWorksheet("Segments")!;
    const names: string[] = [];
    seg.eachRow((r, n) => { if (n > 1 && String(r.getCell(1).value).startsWith("S")) names.push(String(r.getCell(1).value)); });
    expect(names).toEqual(plan.segments.map((s) => s.id));
    expect(seg.getCell(2, 2).value).toBe(`لوح PLATE-001-${plan.segments[0].id}`); // unicode names survive
    expect(back.getWorksheet("Seams")!.rowCount).toBeGreaterThan(plan.seams.length);
    expect(back.getWorksheet("Summary")!.getCell("A1").value).toBe("Part segmentation — لوح PLATE-001");
    const text = JSON.stringify(back.getWorksheet("Summary")!.getSheetValues());
    expect(text).toContain("Reassembly check");
    expect(text).toContain("OK: the finished segments reconstruct the original");
  });
});

/* ---------------- the bundle ---------------- */

describe("export bundle", () => {
  const now = new Date(2026, 9, 22, 10, 0, 0);

  it("contains a DXF per piece, the assembly drawing and the report, with predictable names", async () => {
    const plan = best(plate);
    const b = await buildBundle({ parent: { name: "PLATE-001", qty: 3, th: 10, material: "S235", w: 12000, h: 2980, area: 1 }, original: plate, plan, now });
    const names = b.files.map((f) => f.name);
    expect(names).toEqual([...plan.segments.map((s) => `PLATE-001-${s.id}.dxf`), "PLATE-001-assembly.dxf", "PLATE-001-segmentation-report.xlsx"]);
    expect(b.zipName).toBe("PLATE-001-segmentation.zip");
    const z = readZip(b.zip);
    expect(z.map((e) => e.name)).toEqual(names);
    for (const [i, e] of z.entries()) {
      const src = b.files[i].data;
      expect([...e.data]).toEqual([...(typeof src === "string" ? new TextEncoder().encode(src) : src)]);
    }
    expect(b.pieces.map((p) => p.file)).toEqual(names.slice(0, plan.segments.length)); // the report names the same files
  }, 30000);

  it("file names are safe and unique", async () => {
    expect(safeFileName('A/B:C*"D"?<E>|F')).toBe("A_B_C_D_E_F");
    expect(safeFileName("  ..hidden  ")).toBe("hidden");
    expect(safeFileName("")).toBe("part");
    expect(safeFileName("x".repeat(300))).toHaveLength(100);
    const plan = best(plate);
    const b = await buildBundle({ parent: parent('P/1:"x"', 1), original: plate, plan, now });
    expect(b.files[0].name).toBe(`P_1_x_-${plan.segments[0].id}.dxf`);
    expect(new Set(b.files.map((f) => f.name.toLowerCase())).size).toBe(b.files.length);
  }, 30000);

  it("annotations can be switched on for the piece files only", async () => {
    const plan = best(plate);
    const plain = await buildBundle({ parent: parent("P"), original: plate, plan, now });
    const note = await buildBundle({ parent: parent("P"), original: plate, plan, now, annotations: true });
    const layers = (f: (typeof plain.files)[number]) => new Set(readDxf(f.data as string).ents.map((e) => e.layer));
    expect(layers(plain.files[0])).toEqual(new Set(["CUT"]));
    expect(layers(note.files[0])).toEqual(new Set(["CUT", "LABEL"]));
  }, 30000);

  // The important one: do the exported files reconstruct the original?
  it("REASSEMBLY: the exported pieces, placed at the reported positions, tile the original with no gap or overlap", async () => {
    const plan = best(circle);
    const b = await buildBundle({ parent: parent("CIRCLE-1", 1), original: circle, plan, now });
    const placed = b.pieces.map((p) => {
      const file = b.files.find((f) => f.name === p.file)!.data as string;
      const back = reimport(file); // what the nest would load
      return { outer: translate(back.outer, p.cutX, p.cutY), holes: [] } as Region;
    });
    const rnd = mulberry32(5);
    const orig = regionRings(circle);
    const rings = placed.map((r) => regionRings(r));
    let checked = 0;
    for (let i = 0; i < 6000; i++) {
      const pt: Pt = [(rnd() * 2 - 1) * 3800, (rnd() * 2 - 1) * 3800];
      if (Math.min(ringsDistance(orig, pt), ...rings.map((r) => ringsDistance(r, pt))) < 0.05) continue;
      checked++;
      expect(rings.filter((r) => ringsContain(r, pt)).length).toBe(ringsContain(orig, pt) ? 1 : 0);
    }
    expect(checked).toBeGreaterThan(3000);
  }, 60000);

  it("with an overlap the exported pieces cover the whole original and overlap only along the seams; with a gap they never overlap", async () => {
    for (const mm of [40, -10]) {
      const plan = best(plate, { enabled: true, mm, side: "alternate" });
      const b = await buildBundle({ parent: parent("PLATE", 1), original: plate, plan, now });
      const placed = b.pieces.map((p) => {
        const back = reimport(b.files.find((f) => f.name === p.file)!.data as string);
        return regionRings({ outer: translate(back.outer, p.cutX, p.cutY), holes: [] });
      });
      const orig = regionRings(plate);
      const rnd = mulberry32(9);
      let multi = 0;
      let uncovered = 0;
      for (let i = 0; i < 5000; i++) {
        const pt: Pt = [rnd() * 12000, rnd() * 2980];
        if (placed.some((r) => ringsDistance(r, pt) < 0.05) || ringsDistance(orig, pt) < 0.05) continue;
        const n = placed.filter((r) => ringsContain(r, pt)).length;
        if (n > 1) multi++;
        if (n === 0) uncovered++;
      }
      if (mm > 0) {
        expect(uncovered).toBe(0); // overlap: no gaps
        expect(multi).toBeGreaterThan(0); // … and the pieces do overlap
      } else {
        expect(multi).toBe(0); // gap: never overlap
        expect(uncovered).toBeGreaterThan(0); // … and there are gaps
      }
    }
  }, 60000);

  it("quantity and traceability: the report says what the nest gets", async () => {
    const plan = best(plate);
    const b = await buildBundle({ parent: parent("PLATE-001", 4), original: plate, plan, now });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(b.files[b.files.length - 1].data as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const text = JSON.stringify(wb.getWorksheet("Summary")!.getSheetValues());
    expect(text).toContain(`"Pieces to nest (segments × quantity)",${4 * plan.segments.length}`);
    expect(b.pieces.every((p) => p.qty === 4)).toBe(true);
  }, 30000);
});
