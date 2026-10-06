import ExcelJS from "exceljs";
import { add1DSheets, type Report1DInput } from "./report-1d";
import { add2DSheets, type Report2DInput } from "./report-2d";
import { addKeyValues, addTable, addTitle, pct, round, stamp, workbookToBlob, type Cell, type OverviewRow } from "./excel-common";

export interface CombinedInput {
  projectName?: string;
  /** Plates (2D) — omit if nothing was nested in 2D. */
  d2?: Report2DInput | null;
  /** Bars / pipes / profiles (1D) — omit if nothing was nested in 1D. */
  d1?: Report1DInput | null;
}

/** One line of the weight summary: [item, detail, source kg, used kg, scrap kg, scrap %]. Unknown weights stay empty. */
function weightRow(item: string, detail: string, list: OverviewRow[]): Cell[] {
  if (list.some((x) => x.sourceKg == null || x.usedKg == null)) return [item, detail, null, null, null, null];
  const src = round(list.reduce((s, x) => s + (x.sourceKg ?? 0), 0), 2);
  const used = round(list.reduce((s, x) => s + (x.usedKg ?? 0), 0), 2);
  const scrap = round(src - used, 2);
  return [item, detail, src, used, scrap, pct(scrap, src)];
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
  r = addTable(
    ov, r,
    [
      { header: "Method", width: 12 }, { header: "Material", width: 22 }, { header: "Thickness / Profile", width: 22 },
      { header: "Stock used" }, { header: "Unit" }, { header: "Utilization %", fmt: "0.0" }, { header: "Scrap %", fmt: "0.0" },
      { header: "Scrap qty", fmt: "#,##0.000" }, { header: "Scrap unit" }, { header: "Scrap weight (kg)", fmt: "#,##0.00", sum: true },
    ],
    rows.map((x) => [x.kind, x.material, x.item, x.count, x.unit, x.utilPct, x.scrapPct, x.scrapQty, x.scrapUnit, x.scrapKg]),
    { label: "TOTAL" },
  );

  // Weight + scrap for each material (plates per material, bars/profiles per profile), then one grand total.
  r = addTitle(ov, r, "Summary — Source / Used / Scrap weight (kg)", 12);
  const sumRows: Cell[][] = [];
  const plates = new Map<string, OverviewRow[]>();
  for (const x of rows) if (x.kind === "2D") plates.set(x.material, [...(plates.get(x.material) ?? []), x]);
  for (const [material, list] of plates) {
    const ths = list.map((x) => parseFloat(x.item)).filter((n) => n > 0);
    const range = ths.length ? `${Math.min(...ths)}${Math.max(...ths) !== Math.min(...ths) ? `–${Math.max(...ths)}` : ""} mm` : "—";
    sumRows.push(weightRow(`Plate ${material}`, `${range}, ${list.reduce((s, x) => s + x.count, 0)} sheets`, list));
  }
  const unknownKgm: string[] = [];
  for (const x of rows.filter((y) => y.kind === "1D")) {
    if (x.sourceKg == null) unknownKgm.push(x.item);
    sumRows.push(weightRow(x.item, `${x.material}, ${x.count} bars`, [x]));
  }
  const tot = (i: number) => round(sumRows.reduce((s, x) => s + (typeof x[i] === "number" ? (x[i] as number) : 0), 0), 2);
  r = addTable(
    ov, r,
    [
      { header: "Item" }, { header: "Detail" },
      { header: "Source weight (kg)", fmt: "#,##0.00", sum: true }, { header: "Used weight (kg)", fmt: "#,##0.00", sum: true },
      { header: "Scrap weight (kg)", fmt: "#,##0.00", sum: true }, { header: "Scrap %", fmt: "0.0" },
    ],
    sumRows,
    { label: "TOTAL SCRAP", overrides: { 5: tot(2) > 0 ? pct(tot(4), tot(2)) : 0 } },
  );
  ov.getCell(r - 1, 1).value = "Scrap = source weight − used weight (for bars this includes reusable remnants).";
  if (unknownKgm.length) ov.getCell(r, 1).value = `No kg/m known for: ${unknownKgm.join(", ")} — their weights are left out. Pass weightPerMeter to the 1D report to include them.`;

  return workbookToBlob(wb);
}
