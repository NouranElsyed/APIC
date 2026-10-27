import { describe, expect, it } from "vitest";
import { addManualPart, buildManualShape, coneFlat, cylPartInfo, manualPartName, resizeGroup, type Group } from "./engine";

const geo = (s: Parameters<typeof buildManualShape>[0]) => {
  const r = buildManualShape(s);
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("parts typed in by hand", () => {
  it("rectangle: size and area, with and without a hole", () => {
    const r = geo({ kind: "rect", w: 500, h: 300 });
    expect([r.w, r.h, Math.round(r.area), r.holes.length]).toEqual([500, 300, 150000, 0]);
    const rh = geo({ kind: "rect", w: 500, h: 300, hole: 100 });
    expect(rh.holes).toHaveLength(1);
    expect(Math.round(rh.area)).toBeCloseTo(150000 - Math.PI * 50 * 50, -2);
  });

  it("circle: diameter is the bounding box, hole is a ring", () => {
    const c = geo({ kind: "circle", d: 400 });
    expect(c.w).toBeCloseTo(400, 6);
    expect(c.h).toBeCloseTo(400, 6);
    expect(c.area).toBeGreaterThan(Math.PI * 200 * 200 * 0.999);
    expect(c.area).toBeLessThanOrEqual(Math.PI * 200 * 200);
    const ring = geo({ kind: "circle", d: 400, hole: 150 });
    expect(ring.area).toBeCloseTo(Math.PI * (200 * 200 - 75 * 75), -2);
    // the hole is centred
    const hx = ring.holes[0].map((p) => p[0]);
    expect((Math.min(...hx) + Math.max(...hx)) / 2).toBeCloseTo(200, 3);
  });

  it("triangle: two sides and the angle between them (right, acute and obtuse)", () => {
    const right = geo({ kind: "triangle", a: 300, b: 400, angle: 90 });
    expect(right.area).toBeCloseTo(60000, 3);
    expect(right.w).toBeCloseTo(300, 3);
    expect(right.h).toBeCloseTo(400, 3);
    const t60 = geo({ kind: "triangle", a: 100, b: 100, angle: 60 }); // equilateral
    expect(t60.area).toBeCloseTo((Math.sqrt(3) / 4) * 100 * 100, 3);
    const obtuse = geo({ kind: "triangle", a: 200, b: 100, angle: 135 });
    expect(Math.min(...obtuse.outer.map((p) => p[0]))).toBeCloseTo(0, 6); // moved to the origin
    expect(obtuse.area).toBeCloseTo(0.5 * 200 * 100 * Math.sin((135 * Math.PI) / 180), 3);
  });

  it("triangle hole sits at the incircle centre and is limited to the incircle", () => {
    // 300-400-500 triangle: inradius = (300+400-500)/2 = 100 -> the incircle is 200 mm across, the biggest possible hole
    const t = { kind: "triangle" as const, a: 300, b: 400, angle: 90 };
    expect(buildManualShape({ ...t, hole: 200 })).toHaveProperty("error"); // exactly the incircle: it would touch the edges
    const ok = geo({ ...t, hole: 180 });
    const hx = ok.holes[0].map((p) => p[0]);
    const hy = ok.holes[0].map((p) => p[1]);
    expect((Math.min(...hx) + Math.max(...hx)) / 2).toBeCloseTo(100, 1);
    expect((Math.min(...hy) + Math.max(...hy)) / 2).toBeCloseTo(100, 1);
  });

  it("trapezoid: symmetric and right-angled, area and size", () => {
    const sym = geo({ kind: "trapezoid", a: 400, b: 250, h: 300 });
    expect(sym.area).toBeCloseTo(((400 + 250) / 2) * 300, 3);
    expect([sym.w, sym.h]).toEqual([400, 300]);
    // symmetric: the top edge is centred, 75 mm in from each side
    const top = sym.outer.filter((p) => p[1] === 300).map((p) => p[0]).sort((x, y) => x - y);
    expect(top).toEqual([75, 325]);
    const right = geo({ kind: "trapezoid", a: 400, b: 250, h: 300, right: true });
    expect(right.area).toBeCloseTo(97500, 3);
    expect(right.outer.map((p) => p[0]).includes(0)).toBe(true);
    expect(right.outer).toContainEqual([0, 300]); // the left side is vertical
    expect(right.outer).toContainEqual([250, 300]);
    // top wider than the bottom is still a valid part, moved to the origin
    const wide = geo({ kind: "trapezoid", a: 200, b: 400, h: 100 });
    expect([wide.w, wide.h]).toEqual([400, 100]);
    expect(Math.min(...wide.outer.map((p) => p[0]))).toBeCloseTo(0, 6);
    expect(wide.area).toBeCloseTo(30000, 3);
  });

  it("trapezoid hole: centred, and never wider than the room in the middle", () => {
    const t = { kind: "trapezoid" as const, a: 400, b: 400, h: 200 }; // a plain rectangle: room = 200
    expect(buildManualShape({ ...t, hole: 200 })).toHaveProperty("error");
    const ok = geo({ ...t, hole: 150 });
    const hx = ok.holes[0].map((p) => p[0]);
    const hy = ok.holes[0].map((p) => p[1]);
    expect((Math.min(...hx) + Math.max(...hx)) / 2).toBeCloseTo(200, 1);
    expect((Math.min(...hy) + Math.max(...hy)) / 2).toBeCloseTo(100, 1);
    // the hole stays inside a leaning trapezoid
    const lean = geo({ kind: "trapezoid", a: 600, b: 200, h: 300, hole: 100 });
    const ymin = Math.min(...lean.holes[0].map((p) => p[1]));
    const ymax = Math.max(...lean.holes[0].map((p) => p[1]));
    expect(ymin).toBeGreaterThan(0);
    expect(ymax).toBeLessThan(300);
    expect(buildManualShape({ kind: "trapezoid", a: 600, b: 200, h: 300, hole: 400 })).toHaveProperty("error");
  });

  it("rejects numbers that make no part", () => {
    expect(buildManualShape({ kind: "rect", w: 0, h: 10 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "rect", w: 100, h: 50, hole: 50 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "circle", d: 100, hole: 100 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "circle", d: NaN })).toHaveProperty("error");
    expect(buildManualShape({ kind: "trapezoid", a: 100, b: 0, h: 50 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "trapezoid", a: 100, b: 50, h: NaN })).toHaveProperty("error");
    expect(buildManualShape({ kind: "triangle", a: 10, b: 10, angle: 0 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "triangle", a: 10, b: 10, angle: 180 })).toHaveProperty("error");
  });

  it("addManualPart: new row, then the same part again just adds quantity", () => {
    const c = { id: 10, sn: 3 };
    const a = addManualPart([], { kind: "rect", w: 500, h: 300 }, { th: 8, material: "S235", qty: 2 }, c);
    if ("error" in a) throw new Error(a.error);
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]).toMatchObject({ id: 10, sn: 4, qty: 2, th: 8, material: "S235", name: "Rectangle 500×300" });
    const b = addManualPart(a.groups, { kind: "rect", w: 500, h: 300 }, { th: 8, material: "S235", qty: 3 }, c);
    if ("error" in b) throw new Error(b.error);
    expect(b.merged).toBe(true);
    expect(b.groups).toHaveLength(1);
    expect(b.groups[0].qty).toBe(5);
    // another thickness is another row
    const d = addManualPart(b.groups, { kind: "rect", w: 500, h: 300 }, { th: 10, material: "S235", qty: 1 }, c);
    if ("error" in d) throw new Error(d.error);
    expect(d.groups).toHaveLength(2);
    expect(addManualPart([], { kind: "circle", d: -1 }, { th: 0, material: "", qty: 1 }, c)).toHaveProperty("error");
  });

  it("names", () => {
    expect(manualPartName({ kind: "circle", d: 400, hole: 50 })).toBe("Circle Ø400 / Ø50");
    expect(manualPartName({ kind: "triangle", a: 300, b: 400, angle: 90 })).toBe("Triangle 300-400 90°");
    expect(manualPartName({ kind: "trapezoid", a: 400, b: 250, h: 300 })).toBe("Trapezoid 400/250×300");
    expect(manualPartName({ kind: "trapezoid", a: 400, b: 250, h: 300, right: true, hole: 50 })).toBe("Trapezoid 400/250×300 right Ø50");
  });

  it("resizeGroup: new size, area follows, holes are stretched with the part, original untouched", () => {
    const c = { id: 1, sn: 0 };
    const r = addManualPart([], { kind: "rect", w: 500, h: 300, hole: 100 }, { th: 8, material: "", qty: 1 }, c);
    if ("error" in r) throw new Error(r.error);
    const g: Group = r.groups[0];
    const big = resizeGroup(g, 1000, 600);
    expect(big).not.toBe(g);
    expect([big.w, big.h]).toEqual([1000, 600]);
    expect(big.area).toBeCloseTo(4 * g.area, 0);
    expect(big.id).toBe(g.id);
    expect(big.qty).toBe(g.qty);
    expect(g.w).toBe(500); // the old object is not modified
    const long = resizeGroup(g, 800, 300); // only the length
    expect(long.w).toBe(800);
    // the hole is stretched by 800/500 along the length: its area grows 1.6x (polygon area, not the ideal circle)
    expect(long.area).toBeCloseTo(800 * 300 - 1.6 * (500 * 300 - g.area), 3);
  });
  it("cone: the flat pattern has the right radii, opening angle and area", () => {
    // Ø400 → Ø200, height 300: side 303.3, pattern radii 606.6 / 303.3, opening 118.6°
    const f = coneFlat(400, 200, 300);
    if ("error" in f) throw new Error(f.error);
    expect(f.slant).toBeCloseTo(Math.hypot(300, 100), 6);
    expect(f.R).toBeCloseTo(2 * f.slant, 6);
    expect(f.r).toBeCloseTo(f.slant, 6);
    expect(f.angle).toBeCloseTo((180 * 400) / f.R, 6);
    const g = geo({ kind: "cone", d1: 400, d2: 200, h: 300 });
    const trueArea = (f.angle / 360) * Math.PI * (f.R ** 2 - f.r ** 2);
    expect(g.area / trueArea).toBeGreaterThan(0.999);
    expect(g.area / trueArea).toBeLessThanOrEqual(1.0001);
    expect(g.holes).toHaveLength(0);
    expect(Math.min(...g.outer.map((q) => q[0]))).toBeCloseTo(0, 6);
    expect(Math.min(...g.outer.map((q) => q[1]))).toBeCloseTo(0, 6);
  });

  it("pointed cone (top Ø 0) is a plain sector; a half-height cone opens to 180°", () => {
    const f = coneFlat(200, 0, Math.sqrt(300 ** 2 - 100 ** 2));
    if ("error" in f) throw new Error(f.error);
    expect(f.R).toBeCloseTo(300, 6);
    expect(f.r).toBeCloseTo(0, 6);
    expect(f.angle).toBeCloseTo(120, 6);
    const half = coneFlat(200, 0, Math.sqrt(200 ** 2 - 100 ** 2));
    if ("error" in half) throw new Error(half.error);
    expect(half.angle).toBeCloseTo(180, 6); // slant = Ø → half circle
    const g = geo({ kind: "cone", d1: 200, d2: 0, h: Math.sqrt(200 ** 2 - 100 ** 2) });
    expect(Math.max(g.w, g.h)).toBeCloseTo(400, 1); // half circle of R200: 400 across, 200 deep
    expect(Math.min(g.w, g.h)).toBeCloseTo(200, 1);
  });

  it("cone: bad numbers give a message, name is readable", () => {
    expect(buildManualShape({ kind: "cone", d1: 200, d2: 200, h: 100 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cone", d1: 200, d2: 300, h: 100 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cone", d1: 200, d2: 0, h: 0 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cone", d1: NaN, d2: 0, h: 100 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cone", d1: 200, d2: 0, h: 100, hole: 20 })).toHaveProperty("error");
    expect(manualPartName({ kind: "cone", d1: 400, d2: 200, h: 300 })).toBe("Cone flat Ø400/Ø200×300");
    expect(manualPartName({ kind: "cone", d1: 400, d2: 0, h: 300 })).toBe("Cone flat Ø400×300");
  });

  it("cylinder: flat pattern is a rectangle π·Ø × height", () => {
    const c = geo({ kind: "cylinder", d: 300, h: 500 });
    expect(c.w).toBeCloseTo(Math.PI * 300, 6);
    expect(c.h).toBeCloseTo(500, 6);
    expect(c.area).toBeCloseTo(Math.PI * 300 * 500, 4);
    expect(c.holes).toHaveLength(0);
    expect(buildManualShape({ kind: "cylinder", d: 0, h: 500 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cylinder", d: 300, h: NaN })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cylinder", d: 300, h: 500, hole: 20 })).toHaveProperty("error");
    expect(manualPartName({ kind: "cylinder", d: 300, h: 500 })).toBe("Cylinder flat Ø300×500");
  });

  it("arc: ring-sector area, bounding box and validation", () => {
    // inner R 1000, strip 50 wide, 60° → area = (angle/2)·(R² − r²)
    const g = geo({ kind: "arc", r: 1000, w: 50, angle: 60 });
    const expected = (Math.PI / 3 / 2) * (1050 ** 2 - 1000 ** 2);
    expect(g.area).toBeGreaterThan(expected * 0.999);
    expect(g.area).toBeLessThanOrEqual(expected * 1.0001);
    // chord of the outer edge = 2·R·sin(30°) = R → 1050 wide
    expect(g.w).toBeCloseTo(1050, 0);
    expect(g.h).toBeGreaterThan(0);
    // starts at 0,0 like every other part
    expect(Math.min(...g.outer.map((q) => q[0]))).toBeCloseTo(0, 6);
    expect(Math.min(...g.outer.map((q) => q[1]))).toBeCloseTo(0, 6);
    // inner radius 0 = pie slice
    const pie = geo({ kind: "arc", r: 0, w: 200, angle: 90 });
    expect(pie.area).toBeGreaterThan((Math.PI / 4) * 200 ** 2 * 0.999);
    expect(buildManualShape({ kind: "arc", r: 100, w: 0, angle: 30 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "arc", r: 100, w: 20, angle: 0 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "arc", r: 100, w: 20, angle: 360 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "arc", r: -5, w: 20, angle: 30 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "arc", r: 100, w: 20, angle: 30, hole: 5 })).toHaveProperty("error");
    expect(manualPartName({ kind: "arc", r: 1000, w: 50, angle: 60 })).toBe("Arc R1000 W50 60°");
  });

  it("cylinder and arc can be added to the list like the other shapes", () => {
    const counters = { id: 1, sn: 0 };
    const r1 = addManualPart([], { kind: "cylinder", d: 300, h: 500 }, { th: 3, material: "S235", qty: 2 }, counters);
    if ("error" in r1) throw new Error(r1.error);
    const r2 = addManualPart(r1.groups, { kind: "arc", r: 1000, w: 50, angle: 60 }, { th: 3, material: "S235", qty: 1 }, counters);
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.groups).toHaveLength(2);
    expect(r2.groups.map((g) => g.name)).toEqual(["Cylinder flat Ø300×500", "Arc R1000 W50 60°"]);
  });

  it("cylinder part: flat length is the arc, whichever way the piece is given", () => {
    const R = 2840;
    const byAngle = geo({ kind: "cylpart", r: R, h: 720, by: "angle", v: 30 });
    expect(byAngle.w).toBeCloseTo((R * Math.PI) / 6, 6);
    expect(byAngle.h).toBeCloseTo(720, 6);
    const info = cylPartInfo(R, "chord", 1495);
    if ("error" in info) throw new Error(info.error);
    expect(info.chord).toBeCloseTo(1495, 6);
    expect(info.arc).toBeGreaterThan(1495); // the curve is longer than the chord
    expect(info.arc).toBeCloseTo(R * 2 * Math.asin(1495 / (2 * R)), 6);
    const byChord = geo({ kind: "cylpart", r: R, h: 720, by: "chord", v: 1495 });
    expect(byChord.w).toBeCloseTo(info.arc, 6);
    const byArc = geo({ kind: "cylpart", r: R, h: 720, by: "arc", v: info.arc });
    expect(byArc.w).toBeCloseTo(info.arc, 6);
    expect(info.rise).toBeCloseTo(R - Math.sqrt(R * R - 747.5 ** 2), 6);
  });

  it("cylinder part: bad numbers give a message", () => {
    expect(buildManualShape({ kind: "cylpart", r: 100, h: 50, by: "chord", v: 250 })).toHaveProperty("error"); // chord > Ø
    expect(buildManualShape({ kind: "cylpart", r: 100, h: 50, by: "angle", v: 360 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cylpart", r: 100, h: 50, by: "arc", v: 700 })).toHaveProperty("error"); // > full circle
    expect(buildManualShape({ kind: "cylpart", r: 0, h: 50, by: "angle", v: 30 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cylpart", r: 100, h: 0, by: "angle", v: 30 })).toHaveProperty("error");
    expect(buildManualShape({ kind: "cylpart", r: 100, h: 50, by: "angle", v: 30, hole: 5 })).toHaveProperty("error");
    expect(manualPartName({ kind: "cylpart", r: 2840, h: 720, by: "angle", v: 30 })).toBe("Cylinder part R2840 30° ×720");
  });
});