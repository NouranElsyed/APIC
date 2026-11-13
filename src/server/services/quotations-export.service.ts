import ExcelJS from "exceljs";
import { isoToDate } from "@/features/planning/calendar";
import { STATUS_LABEL, TYPE_LABEL } from "@/features/quotations/quotation";
import type { QuotationDetailDTO, QuotationsData } from "@/features/quotations/dto";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF10233F" } };
const style = (row: ExcelJS.Row) => row.eachCell((c) => { c.fill = HEADER_FILL; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
const date = (iso: string | null) => (iso ? isoToDate(iso) : null);
const NUM = "#,##0.00";

export async function buildQuotationWorkbook(q: QuotationDetailDTO): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SteelFlow";
  const ws = wb.addWorksheet("BOQ", { views: [{ state: "frozen", ySplit: 8 }] });
  ws.addRow([`Quotation ${q.number}${q.revision ? ` — Rev. ${q.revision}` : ""}`]).font = { bold: true, size: 14 };
  ws.addRow([`${q.project.number} — ${q.project.name}`]);
  ws.addRow(["Customer", q.project.customer, "", "Status", STATUS_LABEL[q.status]]);
  ws.addRow(["Issue date", date(q.issueDate), "", "Valid until", date(q.validUntil)]);
  ws.addRow(["Prepared by", q.preparedBy ?? "", "", "Approved by", q.approvedBy ?? ""]);
  ws.addRow(["Description", q.description]);
  ws.addRow([]);
  style(ws.addRow(["#", "Item Description", "Material", "Qty", "Unit", `Unit Rate (${q.currency})`, `Total (${q.currency})`, "Type"]));
  q.items.forEach((i, n) => {
    const r = ws.addRow([n + 1, i.description, i.material ?? "", i.qty, i.unit, i.unitRate, { formula: `D${9 + n}*F${9 + n}`, result: i.total }, TYPE_LABEL[i.type]]);
    r.getCell(4).numFmt = "#,##0.###"; r.getCell(6).numFmt = NUM; r.getCell(7).numFmt = NUM;
  });
  const first = 9, last = 8 + q.items.length;
  const put = (label: string, f: string, v: number) => { const r = ws.addRow(["", "", "", "", "", label, { formula: f, result: v }]); r.getCell(6).font = { bold: true }; r.getCell(7).font = { bold: true }; r.getCell(7).numFmt = NUM; };
  ws.addRow([]);
  const sup = q.items.filter((i) => i.type === "SUPPLY").reduce((s, i) => s + i.total, 0);
  const ins = q.items.filter((i) => i.type === "INSTALL").reduce((s, i) => s + i.total, 0);
  if (q.items.length) {
    put("Total Supply", `SUMIF(H${first}:H${last},"Supply",G${first}:G${last})`, sup);
    put("Total Dismantle & Install", `SUMIF(H${first}:H${last},"Dismantle & Install",G${first}:G${last})`, ins);
    put("Grand Total", `SUM(G${first}:G${last})`, q.grand);
  }
  if (q.profitMargin != null) ws.addRow(["", "", "", "", "", "Profit margin", q.profitMargin / 100]).getCell(7).numFmt = "0.0%";
  [5, 44, 16, 12, 8, 16, 18, 20].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getCell("B4").numFmt = "dd mmm yyyy"; ws.getCell("E4").numFmt = "dd mmm yyyy";

  if (q.terms) {
    const ts = wb.addWorksheet("Terms & Conditions");
    ts.getColumn(1).width = 110;
    q.terms.split(/\r?\n/).forEach((l) => (ts.addRow([l]).getCell(1).alignment = { wrapText: true, vertical: "top" }));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildQuotationsListWorkbook(data: QuotationsData, projectLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SteelFlow";
  const ws = wb.addWorksheet("Quotations", { views: [{ state: "frozen", ySplit: 3 }] });
  ws.addRow([`${projectLabel} — Quotations (${data.today})`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  style(ws.addRow(["#", "Quotation No.", "Rev.", "Section", "Description", "Supply", "Dismantle & Install", "Total", "Currency", "Status", "Issue date", "Valid until"]));
  data.rows.forEach((q, n) => ws.addRow([n + 1, q.number, q.revision, q.section ?? "", q.description, q.supply, q.install, q.total, q.currency, STATUS_LABEL[q.status], date(q.issueDate), date(q.validUntil)]));
  [5, 16, 6, 22, 38, 15, 18, 15, 9, 14, 13, 13].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  [6, 7, 8].forEach((c) => (ws.getColumn(c).numFmt = "#,##0.00"));
  ws.getColumn(11).numFmt = "dd mmm yyyy"; ws.getColumn(12).numFmt = "dd mmm yyyy";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildQuotationTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("BOQ");
  style(ws.addRow(["Item Description", "Material", "Qty", "Unit", "Unit Rate", "Type"]));
  ws.addRow(["Riser Duct Plate 6 mm", "ST37", 24500, "kg", 28.5, "Supply"]);
  ws.addRow(["Dismantle & install riser duct", "", 1, "Lot", 250000, "Dismantle & Install"]);
  [40, 14, 12, 8, 14, 22].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const help = wb.addWorksheet("How to fill");
  ["Keep the header row. Description, Qty and Unit Rate are required.", "Type is optional: write “Supply” or “Dismantle & Install” (default is Supply).", "Total rows (Subtotal / Total) are ignored. Delete the example rows before importing."].forEach((l) => help.addRow([l]));
  help.getColumn(1).width = 100;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
