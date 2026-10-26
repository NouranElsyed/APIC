import { describe, expect, it } from "vitest";
import { calcNozzle, estimatePadDia, scheduleTotals, type NozzleInput, type NozzleOutcome } from "./calc";
import rows from "./fixtures/sheet-nozzles.json";

interface SheetRow {
  tank: string;
  mark: string;
  loc: "shell" | "roof";
  dn: number;
  proj: number;
  qty: number;
  padD: number | null;
  padT: number | null;
  od: number;
  neck: number;
  flange: number;
  pad: number | null;
}
const sheet = rows as SheetRow[];

/**
 * The rows of the workbook that do NOT follow the default rules, each with the reason found when the rules were
 * checked against all 151 rows. They are reproduced with explicit overrides, so a deviation is never silent.
 */
const EXCEPTIONS: Record<string, { why: string; over: Partial<NozzleInput> }> = {};
for (const m of ["N1-1", "N1-2", "N1-3", "N3", "M1", "N7", "N2", "M2"]) {
  // XL-JZ-03 was calculated with 6 mm pads (every other tank: 8 mm shell, 12 mm roof)
  EXCEPTIONS[`XL-JZ-03|${m}`] = { why: "6 mm pad (older sheet)", over: { padThkMm: 6 } };
}
EXCEPTIONS["XL-JZ-05|N8"] = { why: "DN100 roof nozzle without pad", over: { noPad: true } };
EXCEPTIONS["XL-SB-07A|N11"] = { why: "DN150 roof nozzle, projection 150, no pad", over: { noPad: true } };
EXCEPTIONS["XL-SB-07B|N11"] = { why: "DN150 roof nozzle, projection 150, no pad", over: { noPad: true } };
EXCEPTIONS["XL-SB-21|N8"] = { why: "flange 13 kg: row is 'DN225 STD #150 + Elbow 180'", over: { flangeKg: 13 } };
EXCEPTIONS["XL-SB-35|N2"] = { why: "DN125 roof pad Ø485 (every other tank: Ø300)", over: { padDiaMm: 485 } };
EXCEPTIONS["XL-SB-36|N2"] = { why: "DN125 roof pad Ø485 (every other tank: Ø300)", over: { padDiaMm: 485 } };

const key = (r: SheetRow) => `${r.tank}|${r.mark.split(" ")[0]}`;
const toInput = (r: SheetRow, over: Partial<NozzleInput> = {}): NozzleInput => ({
  mark: r.mark,
  location: r.loc,
  kind: r.mark.startsWith("M") && r.dn === 600 ? "manhole" : "nozzle",
  dn: r.dn,
  projectionMm: r.proj,
  qty: 1,
  ...over,
});
const ok = (o: NozzleOutcome) => {
  if (!o.ok) throw new Error(o.error);
  return o;
};

describe("against the workbook (151 nozzle rows, 12 tanks)", () => {
  it("has the rows", () => {
    expect(sheet).toHaveLength(151);
  });

  it("the default rules reproduce every row that is not an exception — neck, flange, pad, OD", () => {
    let checked = 0;
    for (const r of sheet) {
      if (EXCEPTIONS[key(r)]) continue;
      const c = ok(calcNozzle(toInput(r)));
      expect(c.odMm, key(r)).toBeCloseTo(r.od, 2);
      expect(c.neckKg, `${key(r)} neck`).toBeCloseTo(r.neck, 2);
      expect(c.flangeKg, `${key(r)} flange`).toBeCloseTo(r.flange, 2);
      expect(c.padKg, `${key(r)} pad`).toBeCloseTo(r.pad ?? 0, 1);
      checked++;
    }
    expect(checked).toBe(151 - Object.keys(EXCEPTIONS).length);
  });

  it("every exception is reproduced exactly with its override, and the override is reported", () => {
    for (const r of sheet) {
      const ex = EXCEPTIONS[key(r)];
      if (!ex) continue;
      const c = ok(calcNozzle(toInput(r, ex.over)));
      expect(c.neckKg, key(r)).toBeCloseTo(r.neck, 2);
      expect(c.flangeKg, key(r)).toBeCloseTo(r.flange, 2);
      expect(c.padKg, key(r)).toBeCloseTo(r.pad ?? 0, 1);
      expect(c.overrides.length, `${key(r)}: ${ex.why}`).toBeGreaterThan(0);
    }
  });

  it("without the override the exceptions DO differ (so the list is not hiding anything)", () => {
    const differs = sheet.filter((r) => {
      if (!EXCEPTIONS[key(r)]) return false;
      const c = ok(calcNozzle(toInput(r)));
      return Math.abs(c.flangeKg - r.flange) > 0.01 || Math.abs(c.padKg - (r.pad ?? 0)) > 0.05;
    });
    expect(differs).toHaveLength(Object.keys(EXCEPTIONS).length);
  });

  it("unit weight is neck + flange + pad and matches the workbook per tank", () => {
    const byTank = new Map<string, { calc: number; sheet: number }>();
    for (const r of sheet) {
      const ex = EXCEPTIONS[key(r)];
      const c = ok(calcNozzle(toInput(r, ex?.over)));
      const t = byTank.get(r.tank) ?? { calc: 0, sheet: 0 };
      t.calc += c.unitKg;
      t.sheet += r.neck + r.flange + (r.pad ?? 0);
      byTank.set(r.tank, t);
    }
    expect(byTank.size).toBe(12);
    for (const [tank, t] of byTank) expect(t.calc, tank).toBeCloseTo(t.sheet, 1);
  });
});

describe("rules", () => {
  const base: NozzleInput = { mark: "N1", location: "shell", dn: 250, projectionMm: 200, qty: 1 };

  it("DN250 shell: 12.06 + 18 + 13.2 = 43.26 kg (the workbook's N1)", () => {
    const c = ok(calcNozzle(base));
    expect(c.neckKg).toBeCloseTo(12.06, 2);
    expect(c.flangeKg).toBe(18);
    expect(c.padKg).toBeCloseTo(13.2, 2);
    expect(c.unitKg).toBeCloseTo(43.26, 2);
    expect(c.pad).toEqual({ diaMm: 585, thkMm: 8, source: "table" });
    expect(c.warnings).toEqual([]);
  });

  it("quantity multiplies the total only", () => {
    const c = ok(calcNozzle({ ...base, qty: 3 }));
    expect(c.unitKg).toBeCloseTo(43.26, 2);
    expect(c.totalKg).toBeCloseTo(3 * 43.26, 2);
    expect(c.flatParts[0].qty).toBe(3);
  });

  it("DN50 and smaller have no pad", () => {
    for (const dn of [25, 40, 50]) {
      const c = ok(calcNozzle({ ...base, dn }));
      expect(c.padKg).toBe(0);
      expect(c.pad.source).toBe("none");
      expect(c.flatParts).toEqual([]);
    }
  });

  it("a size with no pad entry for this location uses the other location, with a warning", () => {
    const c = ok(calcNozzle({ ...base, dn: 80, location: "shell" }));
    expect(c.pad).toEqual({ diaMm: 265, thkMm: 8, source: "other-location" });
    expect(c.warnings[0]).toMatch(/Confirm/);
  });

  it("the estimate for a size with no pad entry anywhere is 2.2 × OD rounded to 5 mm", () => {
    expect(estimatePadDia(168.3)).toBe(370);
    expect(estimatePadDia(323.9)).toBe(715);
  });

  it("an explicit pad on a small nozzle is accepted and reported as an override", () => {
    const o = ok(calcNozzle({ ...base, dn: 50, padDiaMm: 150 }));
    expect(o.pad.source).toBe("override");
    expect(o.overrides[0]).toMatch(/pad Ø150/);
  });

  it("overrides are listed; the defaults are not", () => {
    expect(ok(calcNozzle(base)).overrides).toEqual([]);
    const c = ok(calcNozzle({ ...base, padDiaMm: 600, padThkMm: 10, flangeKg: 20 }));
    expect(c.overrides).toHaveLength(3);
    expect(c.flangeSource).toBe("override");
  });

  it("DN600 manhole: neck + pad in the schedule weight, ring + cover listed apart (as in the workbook)", () => {
    const shell = ok(calcNozzle({ mark: "M1", location: "shell", kind: "manhole", dn: 600, projectionMm: 200, qty: 1 }));
    expect(shell.neckKg).toBeCloseTo(28.22, 2);
    expect(shell.flangeKg).toBe(0);
    expect(shell.flangeSource).toBe("fabricated");
    expect(shell.padKg).toBeCloseTo(59.33, 2);
    expect(shell.unitKg).toBeCloseTo(87.56, 2); // workbook: 87.56
    const roof = ok(calcNozzle({ mark: "M2", location: "roof", kind: "manhole", dn: 600, projectionMm: 200, qty: 1 }));
    expect(roof.unitKg).toBeCloseTo(67.47, 2); // workbook: 67.47
    // ring 19.98 kg + cover 40.45 kg per manhole
    expect(shell.fabricatedKg).toBeCloseTo(19.98 + 40.45, 1);
    expect(shell.flatParts.map((p) => p.kind)).toEqual(["pad", "manhole-ring", "manhole-cover"]);
    const ringPart = shell.flatParts[1];
    expect(ringPart.kgEach).toBeCloseTo(19.98, 2);
    expect(shell.flatParts[2].kgEach).toBeCloseTo(40.45, 2);
  });

  it("errors are explicit and never throw", () => {
    expect(calcNozzle({ ...base, dn: 225 })).toMatchObject({ ok: false, error: expect.stringMatching(/DN225 is not in the pipe library/) });
    expect(calcNozzle({ ...base, projectionMm: 0 })).toMatchObject({ ok: false });
    expect(calcNozzle({ ...base, qty: 0 })).toMatchObject({ ok: false });
    expect(calcNozzle({ ...base, qty: 1.5 })).toMatchObject({ ok: false });
    expect(calcNozzle({ ...base, kind: "manhole" })).toMatchObject({ ok: false, error: expect.stringMatching(/DN600/) });
    expect(calcNozzle({ ...base, padDiaMm: 200 })).toMatchObject({ ok: false, error: expect.stringMatching(/larger than the pipe OD/) });
    expect(calcNozzle({ ...base, dn: 600 })).toMatchObject({ ok: false, error: expect.stringMatching(/flange weight/) });
    expect(ok(calcNozzle({ ...base, dn: 600, flangeKg: 30 })).flangeKg).toBe(30);
  });
});

describe("scheduleTotals", () => {
  it("sums weights × qty, groups identical flat parts, counts errors", () => {
    const list = [
      calcNozzle({ mark: "N3", location: "shell", dn: 150, projectionMm: 200, qty: 2 }),
      calcNozzle({ mark: "N7", location: "shell", dn: 150, projectionMm: 200, qty: 1 }),
      calcNozzle({ mark: "M1", location: "shell", kind: "manhole", dn: 600, projectionMm: 200, qty: 1 }),
      calcNozzle({ mark: "bad", location: "shell", dn: 999, projectionMm: 200, qty: 1 }),
    ];
    const t = scheduleTotals(list);
    expect(t.errors).toBe(1);
    expect(t.count).toBe(4);
    const one = 5.652 + 9 + 6.49;
    expect(t.totalKg).toBeCloseTo(3 * one + 87.56, 1);
    expect(t.fabricatedKg).toBeCloseTo(60.43, 1);
    const pads = t.flatParts.filter((p) => p.kind === "pad" && p.name.includes("DN150"));
    expect(pads).toHaveLength(1);
    expect(pads[0].qty).toBe(3);
  });
});
