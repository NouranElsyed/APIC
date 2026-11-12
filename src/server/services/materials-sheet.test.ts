import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseMaterialSheet } from "@/features/planning/materials-sheet";
import { buildMaterialsTemplate } from "./materials-export.service";

const resolve = { wbs: (t: string) => (t.toLowerCase() === "fabrication" ? "w-fab" : null), activity: (t: string) => (t.toUpperCase() === "A1020" ? "a-1020" : null) };
async function sheetFrom(rows: (string | number | Date | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("x");
  rows.forEach((r) => ws.addRow(r));
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  return loaded.worksheets[0];
}

describe("materials sheet import", () => {
  it("reads rows, resolves phase/activity and dates, reports problems", async () => {
    const ws = await sheetFrom([
      ["Project: Riser duct"], // junk line above the header
      ["Material", "Grade", "UOM", "Qty", "Stage", "Activity", "Needed", "Remarks"],
      ["Plate 6mm", "ST37", "kg", 24500, "Fabrication", "A1020", new Date("2026-12-01"), "urgent"],
      ["Angle 100x75", null, null, "3,800", "Unknown phase", "ZZZ", "01/12/2026", null],
      [null, null, null, null, null, null, null, null], // blank line
      ["No qty", null, null, "abc", null, null, null, null],
      ["Paint", null, "lot", 1, null, null, "soon", null],
    ]);
    const r = parseMaterialSheet(ws, resolve);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ description: "Plate 6mm", spec: "ST37", unit: "kg", requiredQty: 24500, wbsId: "w-fab", activityId: "a-1020", neededBy: "2026-12-01", notes: "urgent" });
    expect(r.rows[1]).toMatchObject({ requiredQty: 3800, unit: "kg", wbsId: null, activityId: null, neededBy: "2026-12-01" });
    expect(r).toMatchObject({ skipped: 1, badPhase: 1, badActivity: 1, badDate: 1 });
  });

  it("reads the downloadable template back", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildMaterialsTemplate()) as unknown as ArrayBuffer);
    const r = parseMaterialSheet(wb.worksheets[0], resolve);
    if ("error" in r) throw new Error(r.error);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ description: "Riser duct plate", requiredQty: 24500, wbsId: "w-fab", activityId: "a-1020", neededBy: "2026-12-01", code: "M-001" });
  });

  it("explains a missing header", async () => {
    const r = parseMaterialSheet(await sheetFrom([["foo", "bar"], [1, 2]]), resolve);
    expect(r).toHaveProperty("error");
  });
});
