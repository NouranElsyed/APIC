import { describe, expect, it } from "vitest";
import { calcNozzle, type NozzleInput } from "./calc";
import { CAT_DNS, CAT_FLANGE, CAT_PIPE, FLANGE_CLASSES } from "./catalogue-data";

const base: NozzleInput = { mark: "N1", location: "shell", dn: 100, projectionMm: 200, qty: 1 };
const ok = (i: NozzleInput) => {
  const o = calcNozzle(i);
  if (!o.ok) throw new Error(o.error);
  return o;
};

describe("catalogue data (Trouvay & Cauvin, ASME B36.10 / B16.5)", () => {
  it("has the pipe walls and the flange classes", () => {
    expect(Object.keys(CAT_PIPE)).toHaveLength(36);
    expect(Object.keys(CAT_FLANGE).map(Number)).toEqual([...FLANGE_CLASSES]);
    expect(CAT_DNS[0]).toBe(15);
    expect(CAT_DNS[CAT_DNS.length - 1]).toBe(600);
  });

  it("every catalogue kg/m follows (OD − t) × t × 0.02466 within 1.5 %, except one catalogue misprint", () => {
    const off: string[] = [];
    for (const [dn, p] of Object.entries(CAT_PIPE))
      for (const [t, kg] of p.walls) if (Math.abs(((p.od - t) * t * 0.02466 - kg) / kg) > 0.015) off.push(`DN${dn} x ${t}`);
    expect(off).toEqual(["DN1150 x 12.7"]);
  });

  it("class 150 slip-on is lighter than weld-neck", () => {
    for (const dn of [50, 80, 100, 125, 150, 200, 250]) expect(CAT_FLANGE[150][dn].w.SO!).toBeLessThan(CAT_FLANGE[150][dn].w.WN!);
  });

  it("weights rise with class and with DN", () => {
    for (const dn of CAT_DNS) {
      const w = FLANGE_CLASSES.map((c) => CAT_FLANGE[c]?.[dn]?.w.WN).filter((x): x is number => x !== undefined);
      expect(w, `DN${dn}`).toEqual([...w].sort((a, b) => a - b));
    }
    for (const c of FLANGE_CLASSES) {
      const w = CAT_DNS.map((dn) => CAT_FLANGE[c][dn]?.w.WN).filter((x): x is number => x !== undefined);
      expect(w, `class ${c}`).toEqual([...w].sort((a, b) => a - b));
    }
  });
});

describe("calcNozzle", () => {
  it("DN100 class 150 WN, STD: neck 3.214, flange 7.0, pad Ø305 × 8", () => {
    const o = ok({ ...base, padThkMm: 8 });
    expect(o.neckKg).toBeCloseTo(3.214, 3);
    expect(o.flangeKg).toBe(7);
    expect(o.flange).toEqual({ class: 150, type: "WN" });
    expect(o.pipe.wallMm).toBe(6.02);
    expect(o.unitKg).toBeCloseTo(o.neckKg + 7 + o.padKg, 6);
  });

  it("DN40 neck uses the catalogue STD value, 4.05 kg/m", () => {
    expect(ok({ ...base, dn: 40 }).neckKg).toBeCloseTo(0.81, 3);
  });

  it("larger and odd sizes: DN300 class 300 WN and DN65 class 600 slip-on", () => {
    const a = ok({ ...base, dn: 300, flangeClass: 300, projectionMm: 300 });
    expect(a.flangeKg).toBe(62);
    expect(a.odMm).toBeCloseTo(323.8, 1);
    expect(a.warnings.join()).toMatch(/pad/i); // no pad size known for DN300: estimate flagged
    expect(ok({ ...base, dn: 65, flangeClass: 600, flangeType: "SO" }).flangeKg).toBe(CAT_FLANGE[600][65].w.SO);
  });

  it("selects the wall by label and by thickness", () => {
    expect(ok({ ...base, schedule: "XS" }).pipe.wallMm).toBe(8.56);
    expect(ok({ ...base, schedule: "XS" }).neckKg).toBeCloseTo(0.2 * 22.32, 3);
    expect(ok({ ...base, wallMm: 11.13 }).pipe.kgPerM).toBe(28.32); // a B36.10 thickness: catalogue value
    const odd = ok({ ...base, wallMm: 10 });
    expect(odd.pipe.kgPerM).toBeCloseTo((114.3 - 10) * 10 * 0.02466, 6);
    expect(odd.warnings.join()).toMatch(/not a B36\.10 thickness/);
  });

  it("flange type and class change the weight; a missing combination is an error, an override fixes it", () => {
    expect(ok({ ...base, flangeType: "BLIND" }).flangeKg).toBe(8);
    expect(ok({ ...base, flangeClass: 600 }).flangeKg).toBe(19);
    const bad = calcNozzle({ ...base, flangeClass: 1500, flangeType: "SO" });
    expect(bad.ok).toBe(false);
    expect(ok({ ...base, flangeClass: 1500, flangeType: "SO", flangeKg: 28 }).flangeSource).toBe("override");
    expect(calcNozzle({ ...base, dn: 90 }).ok).toBe(false); // no DN90 flange in the catalogue
  });

  it("DN600 manhole still works and keeps its fabricated parts", () => {
    const o = ok({ ...base, kind: "manhole", dn: 600, projectionMm: 200 });
    expect(o.flangeSource).toBe("fabricated");
    expect(o.flange).toBeNull();
    expect(o.fabricatedKg).toBeGreaterThan(0);
  });

});
