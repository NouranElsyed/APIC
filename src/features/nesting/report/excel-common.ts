import ExcelJS from "exceljs";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3864" } };
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const TOTAL_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBFBFBF" } },
  bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
  left: { style: "thin", color: { argb: "FFBFBFBF" } },
  right: { style: "thin", color: { argb: "FFBFBFBF" } },
};

export type Cell = string | number | null;

export interface Col {
  header: string;
  width?: number;
  /** Excel number format, e.g. "#,##0.000". */
  fmt?: string;
  /** Adds a SUM(...) in the totals row for this column. */
  sum?: boolean;
}

export function addTitle(ws: ExcelJS.Worksheet, row: number, text: string, size = 14): number {
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size };
  return row + 1;
}

/** "Label: value" pair lines (project, date, settings...). */
export function addKeyValues(ws: ExcelJS.Worksheet, row: number, pairs: [string, Cell][]): number {
  for (const [k, v] of pairs) {
    ws.getCell(row, 1).value = k;
    ws.getCell(row, 1).font = { bold: true };
    ws.getCell(row, 2).value = v;
    ws.getCell(row, 2).alignment = { horizontal: "left" };
    row++;
  }
  return row;
}

/**
 * Writes a header + rows table starting at `row`. `totals` (optional) writes a
 * totals row: columns flagged `sum` get a live SUM formula (with the computed
 * result cached so it shows without recalculation), `overrides` supplies plain
 * values for ratio columns (utilization %, ...). Returns the next free row.
 */
export function addTable(
  ws: ExcelJS.Worksheet,
  row: number,
  cols: Col[],
  rows: Cell[][],
  totals?: { label: string; overrides?: Record<number, Cell> },
): number {
  const head = ws.getRow(row);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.border = BORDER;
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width ?? 0, c.width ?? Math.max(12, c.header.length + 2));
  });
  const first = row + 1;
  rows.forEach((r, ri) => {
    const wr = ws.getRow(first + ri);
    r.forEach((v, i) => {
      const cell = wr.getCell(i + 1);
      cell.value = v;
      cell.border = BORDER;
      if (cols[i]?.fmt) cell.numFmt = cols[i].fmt!;
    });
  });
  let next = first + rows.length;
  if (totals && rows.length) {
    const tr = ws.getRow(next);
    const last = next - 1;
    cols.forEach((c, i) => {
      const cell = tr.getCell(i + 1);
      cell.fill = TOTAL_FILL;
      cell.font = { bold: true };
      cell.border = BORDER;
      if (c.fmt) cell.numFmt = c.fmt;
      if (i === 0) cell.value = totals.label;
      else if (totals.overrides && i in totals.overrides) cell.value = totals.overrides[i];
      else if (c.sum) {
        const L = ws.getColumn(i + 1).letter;
        const result = rows.reduce((s, r) => s + (typeof r[i] === "number" ? (r[i] as number) : 0), 0);
        cell.value = { formula: `SUM(${L}${first}:${L}${last})`, result };
      }
    });
    next++;
  }
  return next + 1; // blank line after the table
}

/** Places a PNG (data URL) at `row` (1-based) and returns the first free row below it. */
export function addImageAt(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  dataUrl: string,
  row: number,
  width: number,
  height: number,
): number {
  const id = wb.addImage({ base64: dataUrl, extension: "png" });
  ws.addImage(id, { tl: { col: 0, row: row - 1 }, ext: { width, height } });
  return row + Math.ceil(height / 20) + 1; // default row height = 20 px
}

export const round = (v: number, d = 3) => {
  const k = 10 ** d;
  return Math.round(v * k) / k;
};

export const pct = (part: number, whole: number) => (whole > 0 ? round((100 * part) / whole, 1) : 0);

export async function workbookToBlob(wb: ExcelJS.Workbook): Promise<Blob> {
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

/** One line of the combined overview: what was nested and how much scrap it left. */
export interface OverviewRow {
  kind: "2D" | "1D";
  material: string;
  /** Thickness (2D) or profile (1D). */
  item: string;
  count: number;
  unit: "sheets" | "bars";
  utilPct: number;
  scrapPct: number;
  scrapQty: number;
  scrapUnit: "m²" | "m";
  scrapKg: number | null;
  /** Weight of the stock used / of the parts cut from it (kg). null = unknown (e.g. no kg/m for a 1D profile). */
  sourceKg?: number | null;
  usedKg?: number | null;
}

/** Sheet name, optionally prefixed ("2D Summary") when several reports share one workbook. */
export const sheetName = (prefix: string, name: string) => (prefix ? `${prefix} ${name}` : name);
