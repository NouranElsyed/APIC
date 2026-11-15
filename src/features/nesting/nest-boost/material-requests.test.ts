import { describe, expect, it } from "vitest";
import { buildMaterialRequests, toMaterialPayload } from "./material-requests";
import type { Group, OptResult, Sheet } from "./engine";

const g = (o: Partial<Group>): Group => ({ id: 1, sn: 1, name: "p", qty: 1, th: 10, material: "ST37", outer: [], holes: [], w: 1000, h: 1000, area: 1_000_000, per: 4000, ...o });
const sheet = (items: Group[], o: Partial<Sheet> = {}): Sheet => ({ items: items.map((x) => ({ g: x, rot: 0, x: 0, y: 0 })), th: 10, material: "ST37", used: 0, ...o });
const S = { W: 3000, H: 1500 };

describe("buildMaterialRequests", () => {
  it("groups sheets by stock size, thickness and material and splits parts from scrap", () => {
    const res = { sheets: [sheet([g({})]), sheet([g({})]), sheet([g({ id: 2 })], { th: 6, material: "ST52" })], un: [], skip: [] } as unknown as OptResult;
    const lines = buildMaterialRequests(res, S);
    expect(lines).toHaveLength(2);
    const t6 = lines[0], t10 = lines[1];
    expect(t6).toMatchObject({ thicknessMm: 6, material: "ST52", sheets: 1 });
    expect(t10).toMatchObject({ thicknessMm: 10, sheets: 2, widthMm: 3000, heightMm: 1500 });
    // 3 m × 1.5 m × 10 mm × 7.85 = 353.25 kg per sheet; parts 1 m² = 78.5 kg
    expect(t10.sheetKg).toBe(706.5);
    expect(t10.partsKg).toBe(157);
    expect(t10.scrapKg).toBe(549.5);
    expect(t10.scrapPct).toBeCloseTo(77.8, 1);
  });
  it("orders the stock sheet, not a trimmed one", () => {
    const res = { sheets: [sheet([g({})], { W: 1200, H: 1200, stockW: 6000, stockH: 2000 })], un: [], skip: [] } as unknown as OptResult;
    expect(buildMaterialRequests(res, S)[0]).toMatchObject({ widthMm: 6000, heightMm: 2000 });
  });
  it("counts exact and approximate pieces (typed-in shapes default to approximate)", () => {
    const manual = g({ id: 2, shape: { kind: "rect", w: 1, h: 1 } as never });
    const res = { sheets: [sheet([g({}), manual, g({ id: 3, exact: false })])], un: [], skip: [] } as unknown as OptResult;
    expect(buildMaterialRequests(res, S)[0]).toMatchObject({ exactPieces: 1, approxPieces: 2 });
  });
  it("has no weights without a thickness", () => {
    const res = { sheets: [sheet([g({ th: 0 })], { th: 0 })], un: [], skip: [] } as unknown as OptResult;
    const l = buildMaterialRequests(res, S)[0];
    expect(l.sheetKg).toBeNull();
    expect(toMaterialPayload(l, "kg").unit).toBe("sheet");
  });
});

describe("toMaterialPayload", () => {
  const res = { sheets: [sheet([g({})]), sheet([g({ exact: false })])], un: [], skip: [] } as unknown as OptResult;
  const l = buildMaterialRequests(res, S)[0];
  it("orders in sheets", () => expect(toMaterialPayload(l, "sheet")).toMatchObject({ unit: "sheet", requiredQty: 2, code: l.code }));
  it("orders by weight including scrap", () => expect(toMaterialPayload(l, "kg")).toMatchObject({ unit: "kg", requiredQty: 706.5 }));
  it("flags estimates", () => expect(toMaterialPayload(l, "sheet").notes).toContain("ESTIMATE"));
});
