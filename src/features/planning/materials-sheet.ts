// Reads a materials worksheet (Excel) into plain rows. Pure apart from ExcelJS types so it can be tested
// without a database; the caller resolves phase / activity text to ids.

import type ExcelJS from "exceljs";

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("text" in v) return String(v.text);
    if ("result" in v) return String(v.result ?? "");
    if (v instanceof Date) return v.toISOString().slice(0, 10);
  }
  return String(v);
};
const cellDate = (v: ExcelJS.CellValue): string | null => {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const t = cellText(v).trim();
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const dm = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dm) return `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")}`;
  return null;
};
const HEADERS: Record<string, string[]> = {
  description: ["description", "material", "item", "item description", "name"],
  spec: ["spec", "specification", "grade", "size"],
  unit: ["unit", "uom"],
  qty: ["quantity", "qty", "required", "required qty", "required quantity"],
  phase: ["phase", "wbs", "section", "stage"],
  activity: ["activity", "activity id", "activity code"],
  neededBy: ["needed by", "needed", "required date", "required by", "date needed"],
  code: ["code", "item code", "no", "no."],
  notes: ["notes", "remarks", "comment", "comments"],
};


export const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

export interface ParsedMaterialRow {
  description: string; spec: string | null; unit: string; requiredQty: number; wbsId: string | null; activityId: string | null;
  neededBy: string | null; code: string | null; notes: string | null;
}
export type ParsedMaterialSheet =
  | { error: string }
  | { rows: ParsedMaterialRow[]; skipped: number; badPhase: number; badActivity: number; badDate: number };

export function parseMaterialSheet(ws: ExcelJS.Worksheet, resolve: { wbs: (text: string) => string | null; activity: (text: string) => string | null }): ParsedMaterialSheet {
  let headerRow = 0;
  const col: Record<string, number> = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headerRow; r++) {
    const found: Record<string, number> = {};
    ws.getRow(r).eachCell((c, n) => { const t = norm(cellText(c.value)); for (const [k, names] of Object.entries(HEADERS)) if (names.includes(t) && found[k] == null) found[k] = n; });
    if (found.description && found.qty) { headerRow = r; Object.assign(col, found); }
  }
  if (!headerRow) return { error: "Could not find the header row. The sheet needs at least 'Description' and 'Quantity' columns — download the template to see the layout." };
  if (ws.rowCount - headerRow > 2000) return { error: "Please import at most 2000 rows at a time." };

  const rows: ParsedMaterialRow[] = [];
  let skipped = 0, badPhase = 0, badActivity = 0, badDate = 0;
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const get = (k: string) => (col[k] ? ws.getRow(r).getCell(col[k]).value : null);
    const description = cellText(get("description")).trim();
    const rawQty = get("qty");
    if (!description && (rawQty == null || cellText(rawQty) === "")) continue; // blank line
    const qty = typeof rawQty === "number" ? rawQty : parseFloat(cellText(rawQty).replace(/,/g, ""));
    if (!description || !Number.isFinite(qty) || qty < 0) { skipped++; continue; }
    const phaseText = cellText(get("phase")).trim();
    const wbsId = phaseText ? resolve.wbs(phaseText) : null;
    if (phaseText && !wbsId) badPhase++;
    const actText = cellText(get("activity")).trim();
    const activityId = actText ? resolve.activity(actText) : null;
    if (actText && !activityId) badActivity++;
    const nbRaw = get("neededBy");
    const hasDate = nbRaw != null && cellText(nbRaw) !== "";
    const needed = hasDate ? cellDate(nbRaw) : null;
    if (hasDate && !needed) badDate++;
    rows.push({
      description: description.slice(0, 200), spec: cellText(get("spec")).trim().slice(0, 200) || null, unit: cellText(get("unit")).trim().slice(0, 20) || "kg",
      requiredQty: qty, wbsId, activityId, neededBy: needed, code: cellText(get("code")).trim().slice(0, 40) || null, notes: cellText(get("notes")).trim().slice(0, 1000) || null,
    });
  }
  return { rows, skipped, badPhase, badActivity, badDate };
}
