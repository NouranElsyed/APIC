import ExcelJS from "exceljs";
import type { Prices, UsageRow, UsageTotals } from "@/features/material-usage/usage";

export async function buildMaterialUsageWorkbook(args: { projectLabel: string; currency: string; prices: Prices; targetPct: number; rows: UsageRow[]; totals: UsageTotals }): Promise<Buffer> {
  const { projectLabel, currency, prices, targetPct, rows, totals } = args;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Material & Usage", { views: [{ state: "frozen", ySplit: 6 }] });

  ws.addRow([`Material & Usage — ${projectLabel}`]).font = { bold: true, size: 14 };
  ws.addRow([`Material price: ${currency} ${prices.costPerKg}/kg · Scrap resale: ${currency} ${prices.scrapPerKg}/kg · Scrap target: ${targetPct}%`]).font = { italic: true, color: { argb: "FF64748B" } };
  ws.addRow([]);
  ws.addRow(["Used = net part weight. Purchase = stock weight entered per part (parts without one count as no scrap). Loss % = money lost on scrap after resale ÷ purchase cost."]).font = { size: 9, color: { argb: "FF64748B" } };
  ws.addRow([]);

  const head = ws.addRow(["Material", "Standard", "Used Qty (Ton)", "Purchase Qty (Ton)", "Scrap (Ton)", "Scrap %", `Used Cost (${currency})`, `Purchase Cost (${currency})`, `Scrap Value (${currency})`, "Loss %"]);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1D4ED8" } }; c.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });

  const t = (kg: number) => Math.round(kg) / 1000;
  const line = (name: string, std: string, r: Pick<UsageRow, "usedKg" | "purchaseKg" | "scrapKg" | "scrapPct" | "usedCost" | "purchaseCost" | "scrapValue" | "lossPct">) =>
    ws.addRow([name, std, t(r.usedKg), t(r.purchaseKg), t(r.scrapKg), r.scrapPct / 100, r.usedCost, r.purchaseCost, r.scrapValue, r.lossPct / 100]);
  for (const r of rows) line(r.name, r.standard, r);
  const total = line("Total", "", totals);
  total.font = { bold: true };
  total.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } }; });

  ws.columns.forEach((col, i) => { col.width = [26, 14, 16, 18, 14, 10, 18, 20, 20, 10][i]; });
  ws.eachRow((row, n) => {
    if (n < 7) return;
    row.getCell(3).numFmt = row.getCell(4).numFmt = row.getCell(5).numFmt = "#,##0.000";
    row.getCell(6).numFmt = row.getCell(10).numFmt = "0.0%";
    row.getCell(7).numFmt = row.getCell(8).numFmt = row.getCell(9).numFmt = "#,##0";
  });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
