import { describe, expect, it } from "vitest";
import { addManualPart, buildManualShape, manualPartName, resizeGroup, type Group } from "./engine";

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
});
