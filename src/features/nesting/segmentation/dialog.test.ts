import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { parseDXF, type Group, type Pt } from "../nest-boost/engine";
import { candidateFacts, defaultForm, parseForm } from "./form";
import { loopArea, regionArea, regionBBox, sliceRegion } from "./geometry";
import { groupToRegion, recoverArcs } from "./group-region";
import { generateCandidates } from "./planner";
import { loopPath, regionPath, seamLines, svgViewBox } from "./preview-path";
import { PlanPreview, SegmentationPanel } from "./segment-dialog";

/* ---------------- helpers: the importer's own tessellation ---------------- */

/** Same as `arcPts` in nest-boost/engine.ts (steps of at most 5°). */
function arcPts(cx: number, cy: number, r: number, a0: number, sw: number): Pt[] {
  const n = Math.max(3, Math.ceil(Math.abs(sw) / (Math.PI / 36)));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + (sw * i) / n;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Pt;
  });
}
const circlePoly = (cx: number, cy: number, r: number): Pt[] => {
  const p = arcPts(cx, cy, r, 0, 2 * Math.PI);
  p.pop();
  return p;
};
const group = (outer: Pt[], holes: Pt[][] = []): Group => {
  const x0 = Math.min(...outer.map((p) => p[0]));
  const y0 = Math.min(...outer.map((p) => p[1]));
  const o = outer.map(([x, y]) => [x - x0, y - y0] as Pt);
  const h = holes.map((r) => r.map(([x, y]) => [x - x0, y - y0] as Pt));
  return {
    id: 1, sn: 1, name: "PART-001", qty: 1, th: 10, material: "S235",
    outer: o, holes: h, w: Math.max(...o.map((p) => p[0])), h: Math.max(...o.map((p) => p[1])), area: 1, per: 1,
  };
};

/* ---------------- arc rebuilding ---------------- */

describe("recoverArcs", () => {
  it("rebuilds a tessellated circle as a true circle (area exact, not the 72-gon's)", () => {
    const r = recoverArcs(circlePoly(0, 0, 3760));
    expect(r.circle).toBe(true);
    expect(r.loop.every((e) => e.arc && Math.abs(e.arc.r - 3760) < 1e-6)).toBe(true);
    expect(loopArea(r.loop)).toBeCloseTo(Math.PI * 3760 * 3760, 3);
    const polygon = (72 * 3760 * 3760 * Math.sin((2 * Math.PI) / 72)) / 2;
    expect(Math.PI * 3760 * 3760 - polygon).toBeGreaterThan(5000); // the polygon was really smaller (≈ 0.127 %)
  });

  it("rebuilds a quarter-circle pie (line, arc, line)", () => {
    const arc = arcPts(0, 0, 500, 0, Math.PI / 2);
    const r = recoverArcs([[0, 0], ...arc]);
    expect(r.arcs).toBe(1);
    expect(r.loop.filter((e) => e.arc)).toHaveLength(1);
    expect(r.loop).toHaveLength(3);
    expect(r.loop.find((e) => e.arc)!.arc!.sweep).toBeCloseTo(Math.PI / 2, 9);
    expect(loopArea(r.loop)).toBeCloseTo((Math.PI * 500 * 500) / 4, 4);
  });

  it("rebuilds the four corners of a rounded rectangle", () => {
    const R = 20;
    const W = 300;
    const H = 150;
    const pts: Pt[] = [
      ...arcPts(W - R, R, R, -Math.PI / 2, Math.PI / 2),
      ...arcPts(W - R, H - R, R, 0, Math.PI / 2),
      ...arcPts(R, H - R, R, Math.PI / 2, Math.PI / 2),
      ...arcPts(R, R, R, Math.PI, Math.PI / 2),
    ];
    const r = recoverArcs(pts);
    expect(r.arcs).toBe(4);
    expect(loopArea(r.loop)).toBeCloseTo(W * H - (4 - Math.PI) * R * R, 4);
  });

  it("leaves real polygons alone (hexagon, rectangle, irregular)", () => {
    const hex: Pt[] = Array.from({ length: 6 }, (_, i) => [100 * Math.cos((i * Math.PI) / 3), 100 * Math.sin((i * Math.PI) / 3)] as Pt);
    for (const poly of [hex, [[0, 0], [10, 0], [10, 5], [0, 5]] as Pt[], [[0, 0], [10, 1], [12, 8], [5, 11], [-2, 6]] as Pt[]]) {
      const r = recoverArcs(poly);
      expect(r.arcs).toBe(0);
      expect(r.loop.every((e) => !e.arc)).toBe(true);
    }
  });

  it("tolerates coordinate rounding (6 decimals) but not a real deviation", () => {
    // the fitted centre amplifies vertex errors ~1/step² (≈130×), so the tolerance is for rounding-level noise
    const rounded = circlePoly(0, 0, 1000).map(([x, y], i) => [x + (i % 2 ? 5e-7 : -5e-7), y] as Pt);
    expect(recoverArcs(rounded).circle).toBe(true);
    const rough = circlePoly(0, 0, 1000).map(([x, y], i) => [x + (i % 2 ? 0.5 : -0.5), y] as Pt);
    expect(recoverArcs(rough).arcs).toBe(0);
  });

  it("works for a clockwise loop (hole) and keeps the loop closed", () => {
    const cw = circlePoly(0, 0, 50).reverse();
    const r = recoverArcs(cw);
    expect(r.circle).toBe(true);
    expect(loopArea(r.loop)).toBeCloseTo(-Math.PI * 2500, 4);
  });
});

describe("groupToRegion", () => {
  it("plate with a circular hole: area is exact", () => {
    const plate: Pt[] = [[0, 0], [400, 0], [400, 300], [0, 300]];
    const g = group(plate, [circlePoly(200, 150, 60)]);
    const r = groupToRegion(g);
    expect(r.fidelity).toBe("arcs");
    expect(r.arcs).toBe(2);
    expect(regionArea(r.region)).toBeCloseTo(400 * 300 - Math.PI * 3600, 4);
    expect(r.region.holes[0].every((e) => e.arc)).toBe(true);
  });

  it("can be switched off (polygon as imported)", () => {
    const r = groupToRegion(group(circlePoly(0, 0, 100)), { recoverArcs: false });
    expect(r.fidelity).toBe("polygon");
    expect(r.arcs).toBe(0);
    expect(regionArea(r.region)).toBeLessThan(Math.PI * 1e4);
  });

  it("reads parts produced by the REAL DXF parser (CIRCLE, ARC, LWPOLYLINE with bulges)", () => {
    const dxf = (ents: string) => `0\nSECTION\n2\nENTITIES\n${ents}0\nENDSEC\n0\nEOF\n`;
    // CIRCLE r=3760
    const c = parseDXF(dxf("0\nCIRCLE\n8\n0\n10\n0\n20\n0\n40\n3760\n"));
    expect(c.loops).toHaveLength(1);
    const rc = recoverArcs(c.loops[0]);
    expect(rc.circle).toBe(true);
    expect(rc.loop[0].arc!.r).toBeCloseTo(3760, 6);

    // stadium as LWPOLYLINE with two bulge=1 vertices (closed)
    const lw = parseDXF(
      dxf("0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n10\n20\n0\n10\n90\n20\n0\n42\n1\n10\n90\n20\n20\n10\n10\n20\n20\n42\n1\n"),
    );
    expect(lw.loops).toHaveLength(1);
    const rl = recoverArcs(lw.loops[0]);
    expect(rl.arcs).toBe(2);
    expect(loopArea(rl.loop)).toBeCloseTo(80 * 20 + Math.PI * 100, 4);

    // LINE + ARC chained into a closed pie slice
    const pie = parseDXF(
      dxf(
        "0\nLINE\n8\n0\n10\n0\n20\n0\n11\n500\n21\n0\n" +
          "0\nARC\n8\n0\n10\n0\n20\n0\n40\n500\n50\n0\n51\n90\n" +
          "0\nLINE\n8\n0\n10\n0\n20\n500\n11\n0\n21\n0\n",
      ),
    );
    expect(pie.loops).toHaveLength(1);
    const rp = recoverArcs(pie.loops[0]);
    expect(rp.arcs).toBe(1);
    expect(Math.abs(loopArea(rp.loop))).toBeCloseTo((Math.PI * 250000) / 4, 2);
  });

  it("feeds the planner: Ø7520 circle gets exact-arc segments", () => {
    const r = groupToRegion(group(circlePoly(0, 0, 3760)));
    const strips = sliceRegion(r.region, "y", [-3000, -1500, 1500, 3000]);
    const all = strips.strips.flat();
    expect(all.reduce((s, x) => s + regionArea(x), 0)).toBeCloseTo(Math.PI * 3760 * 3760, 3);
    for (const s of all) expect(s.outer.some((e) => e.arc && Math.abs(e.arc.r - 3760) < 1e-6)).toBe(true);
  });
});

/* ---------------- form ---------------- */

describe("form", () => {
  const nest = { mg: 5, ro: 2 };
  const base = () => defaultForm({ W: 6000, H: 1500 });

  it("defaults: one source from the nest, overlap off and EMPTY, no constraints", () => {
    const f = base();
    expect(f.sources).toEqual([{ id: 1, length: "6000", width: "1500" }]);
    expect(f.overlapOn).toBe(false);
    expect(f.overlapMm).toBe("");
    const p = parseForm(f, nest);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.settings.overlap).toEqual({ enabled: false, mm: 0, side: "alternate" });
      expect(p.settings.constraints).toBeUndefined();
      expect(p.settings.directions).toEqual(["H", "V"]);
      expect(p.settings.holePolicy).toBe("reject");
      expect(p.settings.sheet).toEqual({ sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 });
    }
  });

  it("enabled overlap needs a value; no value is assumed", () => {
    const p = parseForm({ ...base(), overlapOn: true }, nest);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors[0]).toMatch(/overlap/i);
    const ok = parseForm({ ...base(), overlapOn: true, overlapMm: "12,5", overlapSide: "symmetric" }, nest);
    expect(ok.ok && ok.settings.overlap).toEqual({ enabled: true, mm: 12.5, side: "symmetric" });
  });

  it("several user-defined sources, validated one by one", () => {
    const f = { ...base(), sources: [...base().sources, { id: 2, length: "8000", width: "2000" }, { id: 3, length: "", width: "1500" }] };
    const p = parseForm(f, nest);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.errors).toEqual(["Source 3: enter a length and a width greater than 0."]);
    const ok = parseForm({ ...f, sources: f.sources.slice(0, 2) }, nest);
    expect(ok.ok && ok.settings.sheet.sheets).toEqual([{ W: 6000, H: 1500 }, { W: 8000, H: 2000 }]);
  });

  it("optional constraints: empty means not enforced, bad numbers are reported", () => {
    const ok = parseForm({ ...base(), minStagger: "300", maxSeam: "", forbidCross: true }, nest);
    expect(ok.ok && ok.settings.constraints).toEqual({ minSeamStagger: 300, forbidCrossJunctions: true });
    const bad = parseForm({ ...base(), minBoundary: "-5" }, nest);
    expect(bad.ok).toBe(false);
  });

  it("maps direction, pattern and the other switches", () => {
    const p = parseForm({ ...base(), direction: "V", pattern: "equal", staggered: false, allowSolo: false, holePolicy: "warn" }, nest, ["C1"]);
    expect(p.ok && p.settings).toMatchObject({ directions: ["V"], pattern: "equal", staggered: false, allowSolo: false, holePolicy: "warn", confirmedHoleCuts: ["C1"] });
  });

  it("formats candidate facts", () => {
    expect(candidateFacts({ segments: 10, cutLength: 35660, sheetsLowerBound: 5, soloSegments: 0 })).toEqual(["10 segments", "35.66 m of seams", "≥ 5 sheets (by area)"]);
    expect(candidateFacts({ segments: 1, cutLength: 0, sheetsLowerBound: 1, soloSegments: 1 })).toContain("1 solo");
  });
});

describe("generator pattern option", () => {
  it('"equal" gives only equal strips; "optimized" adds offsets', () => {
    const region = groupToRegion(group(circlePoly(0, 0, 3760))).region;
    const settings = { directions: ["H" as const], sheet: { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 }, overlap: { enabled: false, mm: 0, side: "A" as const }, holePolicy: "reject" as const, allowSolo: false };
    const eq = generateCandidates(region, { ...settings, pattern: "equal" });
    const opt = generateCandidates(region, { ...settings, pattern: "optimized" });
    expect(new Set(eq.map((c) => c.pattern))).toEqual(new Set(["equal"]));
    expect(opt.length).toBeGreaterThan(eq.length);
  });
});

/* ---------------- SVG helpers ---------------- */

describe("preview-path", () => {
  const circle = groupToRegion(group(circlePoly(0, 0, 100))).region;

  it("draws arcs as SVG arcs, not line segments", () => {
    const d = regionPath(circle);
    expect(d).toMatch(/^M/);
    expect(d).toContain("A100 100 0 0 1");
    expect(d).not.toContain("L");
    expect(d.endsWith("Z")).toBe(true);
  });

  it("encodes arc size and direction flags", () => {
    const pie = recoverArcs([[0, 0], ...arcPts(0, 0, 10, 0, (3 * Math.PI) / 2)]); // 270° arc
    expect(loopPath(pie.loop)).toMatch(/A10 10 0 1 1/); // large arc, counter-clockwise
    const cw = recoverArcs([[0, 0], ...arcPts(0, 0, 10, 0, -Math.PI / 2)]);
    expect(loopPath(cw.loop)).toMatch(/A10 10 0 0 [01]/);
  });

  it("view box is y-flipped and padded", () => {
    const { box, size } = svgViewBox(circle);
    expect(size).toBeCloseTo(200, 6);
    const [x, y, w, h] = box.split(" ").map(Number);
    // `group()` moves the part so its bounding box starts at 0,0 → the circle spans 0…200 in both axes
    expect(x).toBeCloseTo(-12, 2);
    expect(y).toBeCloseTo(-(200 + 12), 2); // y is flipped: the box starts at −(top + padding)
    expect(w).toBeCloseTo(224, 2);
    expect(h).toBeCloseTo(224, 2);
  });

  it("seam lines follow the cut axis", () => {
    expect(seamLines({ axis: "x", pos: 5, intervals: [[0, 10], [20, 30]] })).toEqual([
      { x1: 5, y1: 0, x2: 5, y2: 10 },
      { x1: 5, y1: 20, x2: 5, y2: 30 },
    ]);
    expect(seamLines({ axis: "y", pos: 7, intervals: [[1, 2]] })).toEqual([{ x1: 1, y1: 7, x2: 2, y2: 7 }]);
  });
});

/* ---------------- render smoke tests ---------------- */

describe("render", () => {
  const nest = { W: 6000, H: 1500, mg: 5, ro: 2 };
  const g = group(circlePoly(0, 0, 3760));

  it("the preview renders numbered segments, seams and true arcs", () => {
    const region = groupToRegion(g).region;
    const best = generateCandidates(region, {
      directions: ["H"], sheet: { sheets: [{ W: 6000, H: 1500 }], mg: 5, ro: 2 }, overlap: { enabled: false, mm: 0, side: "A" }, holePolicy: "reject", allowSolo: false,
    })[0];
    const html = renderToStaticMarkup(createElement(PlanPreview, { region, plan: best.plan }));
    expect(html).toContain("<svg");
    for (const s of best.plan.segments) expect(html).toContain(`>${s.id}<`);
    expect(html).toContain("A3760 3760");
    expect(html).toContain("<line");
  });

  it("the panel renders the settings with overlap off and an empty value", () => {
    const html = renderToStaticMarkup(createElement(SegmentationPanel, { group: g, nest }));
    expect(html).toContain("PART-001");
    expect(html).toContain("NEEDS SEGMENTATION");
    expect(html).toContain("2 arcs rebuilt exactly");
    expect(html).toContain("Source sheets");
    expect(html).toContain("Segmentation Settings");
    expect(html).toContain("Optional");
    expect(html).toContain("Enable overlap");
    expect(html).not.toContain("Overlap value (mm)"); // the value field only appears once overlap is enabled
    expect(html).toContain("Generate layouts");
    expect(html).toContain("Edits are a draft");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*Approve segmentation/); // approving is not available yet
  });

  it("bounding box sanity for the rebuilt circle region", () => {
    const [x0, y0, x1, y1] = regionBBox(groupToRegion(g).region);
    expect(x1 - x0).toBeCloseTo(7520, 6);
    expect(y1 - y0).toBeCloseTo(7520, 6);
  });
});
