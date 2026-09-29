import ExcelJS from "exceljs";
import { add1DSheets, type Report1DInput } from "./report-1d";
import { add2DSheets, type Report2DInput } from "./report-2d";
import { addKeyValues, addTable, addTitle, round, stamp, workbookToBlob, type OverviewRow } from "./excel-common";

export interface CombinedInput {
  projectName?: string;
  /** Plates (2D) — omit if nothing was nested in 2D. */
  d2?: Report2DInput | null;
  /** Bars / pipes / profiles (1D) — omit if nothing was nested in 1D. */
  d1?: Report1DInput | null;
}

/** One workbook: an Overview of everything nested, then the full 2D and 1D reports. */
export async function buildReportCombined(input: CombinedInput): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ov = wb.addWorksheet("Overview"); // first tab; filled once the detail sheets are known

  const rows: OverviewRow[] = [];
  if (input.d2) rows.push(...add2DSheets(wb, { ...input.d2, projectName: input.projectName ?? input.d2.projectName }, "2D"));
  if (input.d1) rows.push(...add1DSheets(wb, { ...input.d1, projectName: input.projectName ?? input.d1.projectName }, "1D"));

  let r = addTitle(ov, 1, "Nesting Report — 1D + 2D", 16);
  r = addKeyValues(ov, r, [
    ["Project", input.projectName || "—"],
    ["Date", stamp()],
    ["Included", [input.d2 && "2D plates", input.d1 && "1D bars/pipes"].filter(Boolean).join(" + ") || "—"],
  ]) + 1;

  const sum = (kind: "2D" | "1D", f: (x: OverviewRow) => number) => round(rows.filter((x) => x.kind === kind).reduce((s, x) => s + f(x), 0));
  r = addTitle(ov, r, "Totals", 12);
  r = addKeyValues(ov, r, [
    ["2D — sheets used", sum("2D", (x) => x.count)],
    ["2D — scrap area (m²)", sum("2D", (x) => x.scrapQty)],
    ["2D — scrap weight (kg)", sum("2D", (x) => x.scrapKg ?? 0)],
    ["1D — bars used", sum("1D", (x) => x.count)],
    ["1D — net scrap length (m)", sum("1D", (x) => x.scrapQty)],
  ]) + 1;

  r = addTitle(ov, r, "Material used — all", 12);
  addTable(
    ov, r,
    [
      { header: "Method", width: 12 }, { header: "Material", width: 22 }, { header: "Thickness / Profile", width: 22 },
      { header: "Stock used" }, { header: "Unit" }, { header: "Utilization %", fmt: "0.0" }, { header: "Scrap %", fmt: "0.0" },
      { header: "Scrap qty", fmt: "#,##0.000" }, { header: "Scrap unit" }, { header: "Scrap weight (kg)", fmt: "#,##0.00", sum: true },
    ],
    rows.map((x) => [x.kind, x.material, x.item, x.count, x.unit, x.utilPct, x.scrapPct, x.scrapQty, x.scrapUnit, x.scrapKg]),
    { label: "TOTAL" },
  );

  return workbookToBlob(wb);
}
