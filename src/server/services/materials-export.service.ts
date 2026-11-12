import ExcelJS from "exceljs";
import { isoToDate } from "@/features/planning/calendar";
import type { MaterialsData } from "./materials.service";

const toDate = (iso: string | null) => (iso ? isoToDate(iso) : null);

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF10233F" } };
const STATUS_FILL: Record<string, string> = { NOT_ORDERED: "FFFEE2E2", ORDERED: "FFDBEAFE", PARTIAL: "FFFEF3C7", DELIVERED: "FFDCFCE7", LATE: "FFFECACA" };
const STATUS_LABEL: Record<string, string> = { NOT_ORDERED: "Not ordered", ORDERED: "Ordered", PARTIAL: "Partially delivered", DELIVERED: "Delivered", LATE: "Late" };

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => { c.fill = HEADER_FILL; c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.alignment = { vertical: "middle", horizontal: "center", wrapText: true }; });
}

export async function buildMaterialsWorkbook(data: MaterialsData, projectLabel: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "SteelFlow";
  const ws = wb.addWorksheet("Materials", { views: [{ state: "frozen", ySplit: 3, xSplit: 3 }] });
  ws.addRow([`${projectLabel} — Material follow-up (${data.today})`]).font = { bold: true, size: 14 };
  ws.addRow([]);
  styleHeader(ws.addRow(["#", "Code", "Description", "Spec", "Unit", "Phase", "Activity", "Needed by", "Required", "Ordered", "Received", "To order", "% received", "Status", "Suppliers", "Urgent", "Notes"]));
  data.items.forEach((m, i) => {
    const r = ws.addRow([i + 1, m.code ?? "", m.description, m.spec ?? "", m.unit, m.phase ?? "", m.activityCode ?? "", toDate(m.neededBy), m.requiredQty, m.orderedQty, m.receivedQty, m.toOrder, m.percentReceived / 100, STATUS_LABEL[m.status], m.suppliers.join(", "), m.urgent ? "Yes" : "", m.notes ?? ""]);
    r.getCell(14).fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_FILL[m.status] } };
  });
  [8, 12, 38, 22, 8, 26, 12, 13, 11, 11, 11, 11, 11, 18, 30, 8, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.getColumn(8).numFmt = "dd mmm yyyy"; ws.getColumn(13).numFmt = "0%";
  [9, 10, 11, 12].forEach((c) => (ws.getColumn(c).numFmt = "#,##0.###"));

  const os = wb.addWorksheet("Purchase orders", { views: [{ state: "frozen", ySplit: 1 }] });
  styleHeader(os.addRow(["Material", "Supplier", "PO number", "Ordered qty", "Unit", "Unit price", "Value", "Order date", "Expected", "Received qty", "Received date", "Late"]));
  for (const m of data.items) for (const o of m.orders) os.addRow([m.description, o.supplier, o.poNumber ?? "", o.orderedQty, m.unit, o.unitPrice ?? "", o.value ?? "", toDate(o.orderDate), toDate(o.expectedDate), o.receivedQty, toDate(o.receivedDate), o.late ? "Yes" : ""]);
  [36, 24, 14, 12, 8, 11, 13, 13, 13, 12, 13, 7].forEach((w, i) => (os.getColumn(i + 1).width = w));
  [8, 9, 11].forEach((c) => (os.getColumn(c).numFmt = "dd mmm yyyy"));
  [4, 6, 7, 10].forEach((c) => (os.getColumn(c).numFmt = "#,##0.###"));

  const ps = wb.addWorksheet("By phase");
  styleHeader(ps.addRow(["Phase", "Items", "Delivered", "Not ordered", "Late", "% received"]));
  for (const p of data.phases) ps.addRow([p.phase, p.total, p.delivered, p.notOrdered, p.late, p.percent / 100]);
  ps.getColumn(1).width = 34; ps.getColumn(6).numFmt = "0%";
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildMaterialsTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Materials");
  styleHeader(ws.addRow(["Description", "Spec", "Unit", "Quantity", "Phase", "Activity ID", "Needed by", "Code", "Notes"]));
  ws.addRow(["Riser duct plate", "ST37 · 6 mm", "kg", 24500, "Fabrication", "A1020", "2026-12-01", "M-001", "Example row — delete it"]);
  [34, 22, 8, 12, 24, 12, 13, 10, 28].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  const help = wb.addWorksheet("How to fill");
  ["Description and Quantity are required.", "Phase: the WBS code or name from the schedule (optional).", "Activity ID: the activity code from the schedule (optional) — its start date becomes the needed-by date when you leave 'Needed by' empty.", "Needed by: a date (YYYY-MM-DD)."].forEach((t) => help.addRow([t]));
  help.getColumn(1).width = 110;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

