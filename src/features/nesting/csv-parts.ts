import type { Piece1DInput } from "./part-routing";

export const PARTS_CSV_TEMPLATE =
  "name,profile,material,length_mm,qty\r\n" +
  "Column leg,IPE120,S235,2450,4\r\n" +
  "Bracket,FB50x10,S235,600,12\r\n";

/** Splits one CSV record honouring quotes; delimiter is auto-detected by the caller. */
function splitLine(line: string, d: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === d) { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const ALIASES: Record<keyof Piece1DInput, string[]> = {
  partType: ["type", "parttype", "kind"],
  name: ["name", "part", "partname", "description", "desc", "item"],
  profile: ["profile", "section", "size"],
  material: ["material", "grade", "mat"],
  length: ["length", "lengthmm", "len", "cutlength", "lmm"],
  qty: ["qty", "quantity", "pcs", "count", "nos"],
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** "plate", "PL", "hot rolled", "HR", "pipe", "tube"... -> part type (undefined when not recognised). */
export function parsePartType(v: string): Piece1DInput["partType"] {
  const k = norm(v);
  if (!k) return undefined;
  if (k === "plate" || k === "pl" || k === "flat") return "PLATE";
  if (k === "pipe" || k === "tube") return "PIPE";
  if (k === "hotrolled" || k === "hr" || k === "hotroll" || k === "section" || k === "profile") return "HOT_ROLLED";
  return undefined;
}

export interface CsvParseResult {
  pieces: Piece1DInput[];
  errors: string[];
}

/**
 * Parses a parts CSV for the 1D tool. Needs a header row with at least a
 * length and a qty column (name/profile/material optional). Accepts , ; or
 * tab as delimiter and a UTF-8 BOM (Excel exports).
 */
export function parsePartsCsv(text: string): CsvParseResult {
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!lines.length) return { pieces: [], errors: ["The file is empty."] };

  const head = lines[0];
  const d = [",", ";", "\t"].map((c) => [c, head.split(c).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const header = splitLine(head, d).map(norm);
  const idx = {} as Record<keyof Piece1DInput, number>;
  (Object.keys(ALIASES) as (keyof Piece1DInput)[]).forEach((k) => {
    idx[k] = header.findIndex((h) => ALIASES[k].includes(h));
  });
  if (idx.length < 0 || idx.qty < 0) {
    return { pieces: [], errors: ["The header row must contain a length column (e.g. length_mm) and a qty column."] };
  }

  const pieces: Piece1DInput[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = splitLine(lines[i], d);
    const get = (k: keyof Piece1DInput) => (idx[k] >= 0 ? c[idx[k]] ?? "" : "");
    const length = Number(get("length").replace(",", "."));
    const qty = Number(get("qty").replace(",", "."));
    if (!(length > 0)) { errors.push(`Row ${i + 1}: invalid length "${get("length")}"`); continue; }
    if (!(qty > 0)) { errors.push(`Row ${i + 1}: invalid qty "${get("qty")}"`); continue; }
    const name = get("name");
    // No profile column (or an empty cell): the part label is the section, e.g. "IPE 300",
    // so it can be matched against stock sources of the same profile.
    const profile = get("profile") || name;
    pieces.push({ name, profile, material: get("material"), length, qty: Math.round(qty), partType: parsePartType(get("partType")) });
  }
  return { pieces, errors };
}
