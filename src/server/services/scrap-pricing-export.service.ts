import ExcelJS from "exceljs";
import type { ScrapPricingResult, ScrapPricingExportContext } from "./scrap-pricing.service";

// Mirrors the "pricing" sheet of calculate_area_formatted.xlsx: same column
// order/headers, same assumption + two-way summary section (Scrap % from
// Bought Mat. / Scrap % from Used Mat.), same units row. Formulas are kept
// live where the reference sheet keeps them live, so the exported workbook
// stays recalculable if someone tweaks an input cell in Excel — but the
// *values* written are always the server's authoritative calculation.

const HEADERS = [
  "Item", "Used Area", "Used Weight", "Cost /kg", "Buy QTY", "Buy Area", "buy Weight",
  "Primary Scrap", "Cost Used (LE)", "% Used Later", "Weight Scrap used later",
  "Used Later Price", "Used later Cost", "Used later Value", "Scrap Weight",
  "Scrap Cost Basis", "Scrap Sell Value", "Net Scrap Adj.", "Value Used",
  "Buy Cost (LE)", "Actual Scrap %",
] as const;

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
// Matches the reference workbook: light-blue band across the data rows,
// with the "Primary Scrap" column called out in yellow.
const DATA_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E2F3" } };
const HIGHLIGHT_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };

function buildPartListSheet(wb: ExcelJS.Workbook, parts: ScrapPricingExportContext["parts"]) {
  const ws = wb.addWorksheet("Part List", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [
    "Item No", "Drawing No", "Description", "Material", "Thickness (mm)",
    "Qty", "DXF Area (m2)", "BBox W (mm)", "BBox H (mm)",
  ];
  ws.columns = headers.map((h) => ({ header: h, width: Math.max(14, h.length + 2) }));
  ws.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  parts.forEach((p, i) => {
    const row = ws.getRow(2 + i);
    row.values = [
      p.itemNo, p.drawing.drawingNumber, p.description, p.material, p.thicknessMm,
      p.qty, p.dxfAreaSqm, p.bboxWidthMm, p.bboxHeightMm,
    ];
    row.getCell(5).numFmt = "#,##0.00";
    row.getCell(7).numFmt = "#,##0.0000";
    row.getCell(8).numFmt = "#,##0.0";
    row.getCell(9).numFmt = "#,##0.0";
  });
  return ws;
}

function buildNestingSheet(wb: ExcelJS.Workbook, sheets: ScrapPricingExportContext["sheets"]) {
  const ws = wb.addWorksheet("Nesting", { views: [{ state: "frozen", ySplit: 1 }] });
  const headers = [
    "Sheet #", "Material", "Thickness (mm)", "Width (mm)", "Length (mm)",
    "Used Area (m2)", "Scrap Area (m2)", "Utilization %", "Item No", "Instance",
    "X (mm)", "Y (mm)", "Rotation (deg)",
  ];
  ws.columns = headers.map((h) => ({ header: h, width: Math.max(13, h.length + 2) }));
  ws.getRow(1).eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  let rowNum = 2;
  for (const sheet of sheets) {
    const placements = sheet.placements.length ? sheet.placements : [null];
    const firstRowOfSheet = rowNum;
    for (const pl of placements) {
      const row = ws.getRow(rowNum);
      row.values = [
        sheet.sheetNumber, sheet.material, sheet.thicknessMm, sheet.widthMm, sheet.lengthMm,
        sheet.usedAreaSqm, sheet.scrapAreaSqm, sheet.utilizationPercent != null ? sheet.utilizationPercent / 100 : null,
        pl?.itemNo ?? "", pl?.instanceNumber ?? "", pl?.xMm ?? "", pl?.yMm ?? "", pl?.rotationDeg ?? "",
      ];
      [3, 4, 5, 6, 7].forEach((c) => (row.getCell(c).numFmt = "#,##0.00"));
      row.getCell(8).numFmt = "0.0%";
      rowNum++;
    }
    if (placements.length > 1) {
      ws.mergeCells(firstRowOfSheet, 1, rowNum - 1, 1);
      ws.mergeCells(firstRowOfSheet, 2, rowNum - 1, 2);
      ws.mergeCells(firstRowOfSheet, 3, rowNum - 1, 3);
      ws.mergeCells(firstRowOfSheet, 4, rowNum - 1, 4);
      ws.mergeCells(firstRowOfSheet, 5, rowNum - 1, 5);
      ws.mergeCells(firstRowOfSheet, 6, rowNum - 1, 6);
      ws.mergeCells(firstRowOfSheet, 7, rowNum - 1, 7);
      ws.mergeCells(firstRowOfSheet, 8, rowNum - 1, 8);
    }
  }
  return ws;
}

export function buildScrapPricingWorkbook(
  result: ScrapPricingResult,
  meta: { projectNumber: string; projectName: string; inputs: { costPerKg: number; usedLaterPct: number; usedLaterPriceLEPerKg: number; scrapSellPriceLEPerKg: number } },
  context: ScrapPricingExportContext,
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SteelFlow";
  wb.created = new Date();

  buildPartListSheet(wb, context.parts);
  buildNestingSheet(wb, context.sheets);

  const ws = wb.addWorksheet("Scrap Calculation", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = HEADERS.map((h) => ({ header: h, width: Math.max(14, h.length + 2) }));

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  const firstDataRow = 2;
  result.rows.forEach((r, i) => {
    const rowNum = firstDataRow + i;
    const row = ws.getRow(rowNum);
    row.values = [
      r.itemLabel,
      r.usedAreaSqm,
      r.usedWeightKg,
      r.costPerKg,
      r.buyQty,
      r.buyAreaSqm,
      r.buyWeightKg,
      { formula: `1-(C${rowNum}/G${rowNum})` }, // Primary Scrap %
      { formula: `D${rowNum}*C${rowNum}` }, // Cost Used
      r.usedLaterPct,
      { formula: `(G${rowNum}-C${rowNum})*J${rowNum}` }, // Weight Scrap used later
      r.usedLaterPriceLEPerKg,
      { formula: `K${rowNum}*D${rowNum}` }, // Used later Cost
      { formula: `K${rowNum}*L${rowNum}` }, // Used later Value
      { formula: `G${rowNum}-C${rowNum}-K${rowNum}` }, // Scrap Weight (actual)
      { formula: `O${rowNum}*D${rowNum}` }, // Scrap Cost Basis
      { formula: `O${rowNum}*${r.scrapSellPriceLEPerKg}` }, // Scrap Sell Value
      { formula: `(P${rowNum}-Q${rowNum})+(M${rowNum}-N${rowNum})` }, // Net Scrap Adj.
      { formula: `I${rowNum}+Q${rowNum}+N${rowNum}` }, // Value Used
      { formula: `D${rowNum}*G${rowNum}` }, // Buy Cost
      { formula: `1-(S${rowNum}/T${rowNum})` }, // Actual Scrap %
    ];
    row.getCell(8).numFmt = "0.0%";
    row.getCell(21).numFmt = "0.0%";
    row.getCell(10).numFmt = "0.0%";
    [2, 3, 5, 6, 7, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20].forEach((c) => (row.getCell(c).numFmt = "#,##0.00"));
    // Columns B..U get the light-blue band; "Primary Scrap" (H) is yellow.
    for (let c = 2; c <= 21; c++) row.getCell(c).fill = DATA_FILL;
    row.getCell(8).fill = HIGHLIGHT_FILL;
  });

  const lastDataRow = firstDataRow + result.rows.length - 1;
  const totalsRow = lastDataRow + 2;

  const t = result.totals;
  const total = ws.getRow(totalsRow);
  total.values = [
    "TOTAL",
    { formula: `SUM(B${firstDataRow}:B${lastDataRow})` },
    { formula: `SUM(C${firstDataRow}:C${lastDataRow})` },
    t.avgCostPerKg,
    "",
    { formula: `SUM(F${firstDataRow}:F${lastDataRow})` },
    { formula: `SUM(G${firstDataRow}:G${lastDataRow})` },
    "",
    { formula: `SUM(I${firstDataRow}:I${lastDataRow})` },
    "",
    { formula: `SUM(K${firstDataRow}:K${lastDataRow})` },
    "",
    { formula: `SUM(M${firstDataRow}:M${lastDataRow})` },
    { formula: `SUM(N${firstDataRow}:N${lastDataRow})` },
    { formula: `SUM(O${firstDataRow}:O${lastDataRow})` },
    { formula: `SUM(P${firstDataRow}:P${lastDataRow})` },
    { formula: `SUM(Q${firstDataRow}:Q${lastDataRow})` },
    { formula: `SUM(R${firstDataRow}:R${lastDataRow})` },
    { formula: `SUM(S${firstDataRow}:S${lastDataRow})` },
    { formula: `SUM(T${firstDataRow}:T${lastDataRow})` },
    "",
  ];
  total.eachCell((cell) => { cell.fill = TOTAL_FILL; cell.font = { bold: true }; });
  [2, 3, 4, 6, 7, 9, 11, 13, 14, 15, 16, 17, 18, 19, 20].forEach((c) => (total.getCell(c).numFmt = "#,##0.00"));

  const unitsRow = ws.getRow(totalsRow + 1);
  unitsRow.getCell(2).value = "m2";
  unitsRow.getCell(3).value = "Kg";
  unitsRow.getCell(4).value = "LE/kg";
  unitsRow.getCell(9).value = "LE";
  unitsRow.getCell(18).value = "LE";
  unitsRow.eachCell((c) => (c.font = { italic: true, size: 9, color: { argb: "FF808080" } }));

  // Sum-based grand-total percentages — never an average of row percentages
  // (matches the reference sheet's T19/T20 formulas).
  const summaryStartRow = totalsRow + 3;
  ws.getCell(`A${summaryStartRow}`).value = "Scrap % from Bought Mat.";
  ws.getCell(`C${summaryStartRow}`).value = { formula: `1-(S${totalsRow}/T${totalsRow})` } as ExcelJS.CellFormulaValue;
  ws.getCell(`C${summaryStartRow}`).numFmt = "0.00%";
  ws.getCell(`D${summaryStartRow}`).value = { formula: `C${summaryStartRow}*T${totalsRow}` } as ExcelJS.CellFormulaValue;
  ws.getCell(`D${summaryStartRow}`).numFmt = "#,##0.00";

  ws.getCell(`A${summaryStartRow + 1}`).value = "Scrap % from Used Mat.";
  ws.getCell(`C${summaryStartRow + 1}`).value = { formula: `R${totalsRow}/I${totalsRow}` } as ExcelJS.CellFormulaValue;
  ws.getCell(`C${summaryStartRow + 1}`).numFmt = "0.00%";
  ws.getCell(`D${summaryStartRow + 1}`).value = { formula: `C${summaryStartRow + 1}*I${totalsRow}` } as ExcelJS.CellFormulaValue;
  ws.getCell(`D${summaryStartRow + 1}`).numFmt = "#,##0.00";

  const assumptionRow = summaryStartRow + 3;
  ws.getCell(`A${assumptionRow}`).value = "Assumptions";
  ws.getCell(`A${assumptionRow}`).font = { italic: true, color: { argb: "FF808080" } };
  ws.getCell(`B${assumptionRow}`).value = `Cost/kg = ${meta.inputs.costPerKg} LE/kg`;
  ws.getCell(`B${assumptionRow + 1}`).value = `% Used Later = ${(meta.inputs.usedLaterPct * 100).toFixed(1)}%`;
  ws.getCell(`B${assumptionRow + 2}`).value = `Used Later Price = ${meta.inputs.usedLaterPriceLEPerKg} LE/kg`;
  ws.getCell(`B${assumptionRow + 3}`).value = `Scrap Selling Price = ${meta.inputs.scrapSellPriceLEPerKg} LE/kg`;
  for (let i = 0; i < 4; i++) {
    ws.getCell(`B${assumptionRow + i}`).font = { italic: true, size: 9, color: { argb: "FF808080" } };
  }

  const infoSheet = wb.addWorksheet("Project");
  infoSheet.columns = [{ header: "Field", width: 24 }, { header: "Value", width: 40 }];
  infoSheet.addRow(["Project Number", meta.projectNumber]);
  infoSheet.addRow(["Project Name", meta.projectName]);
  infoSheet.addRow(["Nesting Run ID", result.nestingRunId]);
  infoSheet.addRow(["Generated At", new Date().toISOString()]);
  infoSheet.getRow(1).font = { bold: true };

  return wb;
}
