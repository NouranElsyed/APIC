// Reads a BOQ spreadsheet (already converted to a 2-D array) into quotation items.
import type { QType } from "./quotation";

export interface ParsedItem { description: string; material: string | null; qty: number; unit: string; unitRate: number; type: QType }
export interface ParsedSheet { items: ParsedItem[]; warnings: string[] }

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = Number(String(v ?? "").replace(/[, ]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

// A header matches an alias exactly or as its first words ("Unit Rate (EGP)" -> "unit rate").
const is = (cell: unknown, names: string[]) => { const n = norm(cell); return names.some((a) => n === a || n.startsWith(`${a} `)); };

const ALIASES: Record<string, string[]> = {
  description: ["description", "item description", "item", "details"],
  material: ["material", "grade", "spec"],
  qty: ["qty", "quantity"],
  unit: ["unit", "uom"],
  rate: ["unit rate", "rate", "unit price", "price"],
  type: ["type", "category", "scope"],
};

export function parseQuotationSheet(rows: unknown[][]): ParsedSheet {
  const warnings: string[] = [];
  const headerIdx = rows.findIndex((r) => r.some((c) => is(c, ALIASES.description)) && r.some((c) => is(c, ALIASES.rate)));
  if (headerIdx < 0) return { items: [], warnings: ["Could not find a header row with “Description” and “Unit Rate” columns."] };
  const col: Record<string, number> = {};
  rows[headerIdx].forEach((c, i) => {
    for (const [k, names] of Object.entries(ALIASES)) if (col[k] === undefined && is(c, names)) col[k] = i;
  });
  if (col.qty === undefined) return { items: [], warnings: ["Missing a “Qty” column."] };

  const items: ParsedItem[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const description = String(row[col.description] ?? "").trim();
    if (!description) continue;
    const qty = num(row[col.qty]);
    const unitRate = num(row[col.rate]);
    if (/^(sub)?total/.test(norm(description))) continue;
    if (!Number.isFinite(qty) || qty < 0 || !Number.isFinite(unitRate) || unitRate < 0) {
      warnings.push(`Row ${r + 1} (“${description}”): quantity or unit rate is not a valid number — skipped.`);
      continue;
    }
    const typeText = col.type === undefined ? "" : norm(row[col.type]);
    items.push({
      description,
      material: col.material === undefined ? null : String(row[col.material] ?? "").trim() || null,
      qty, unitRate,
      unit: (col.unit === undefined ? "" : String(row[col.unit] ?? "").trim()) || "kg",
      type: /install|dismantle|erect/.test(typeText) ? "INSTALL" : "SUPPLY",
    });
  }
  if (items.length === 0 && warnings.length === 0) warnings.push("No BOQ rows found under the header.");
  return { items, warnings };
}
