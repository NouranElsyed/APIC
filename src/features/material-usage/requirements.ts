// Pure logic for "Material Requirements": what raw material a project needs, how much of it we already have,
// and what is still missing. No Prisma / React, so it can be unit-tested.

export type ReqType = "Plate" | "Pipe" | "Profile" | "Flat" | "Other";
export type ReqStatus = "AVAILABLE" | "SHORTAGE" | "TO_ORDER" | "ORDERED";

export interface ReqRow {
  id: string;
  /** PlanMaterial id; null for rows worked out from the Part List (they cannot be ordered until sent to Materials) */
  materialId: string | null;
  type: ReqType;
  /** e.g. "PL 8 × 2000 × 6000 mm", "IPE 300", "Ø 88.9 × 5 mm" */
  spec: string;
  grade: string;
  standard: string;
  thicknessMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  required: number;
  unit: string;
  weightKg: number | null;
  available: number;
  ordered: number;
  received: number;
  shortage: number;
  /** what is still to be ordered = shortage − what is already on order and not yet received */
  toOrder: number;
  status: ReqStatus;
  source: "MATERIALS" | "PART_LIST";
  notes: string | null;
}

export const STEEL_KG_PER_M2_MM = 7.85;
const EPS = 1e-6;
export const r1 = (n: number) => Math.round(n * 10) / 10;

export function classify(text: string): ReqType {
  const t = text.toLowerCase();
  if (/\b(pipe|tube|tubing)\b|ø|\bdn\s?\d+/.test(t)) return "Pipe";
  if (/\b(fb|flat|bar)\b/.test(t)) return "Flat";
  if (/\b(ipe|ipn|hea|heb|hem|upn|upe|angle|channel|beam|rsj|shs|rhs|chs)\b|\bl\s?\d+\s?[x×]/.test(t)) return "Profile";
  if (/plate|sheet|\bpl\b|nest-|cone/.test(t)) return "Plate";
  return "Other";
}

/** Material codes made by "Send to Materials": NEST-<thickness>-<grade|ANY>-<W>x<H> */
export function parseNestCode(code: string | null | undefined): { thicknessMm: number; grade: string | null; widthMm: number; heightMm: number } | null {
  const m = /^NEST-([\d.]+)-(.+)-(\d+)x(\d+)$/.exec(code ?? "");
  if (!m) return null;
  return { thicknessMm: Number(m[1]), grade: m[2] === "ANY" ? null : m[2], widthMm: Number(m[3]), heightMm: Number(m[4]) };
}

const GRADE_RE = /\b(S\s?\d{3}\s?[A-Z0-9]*|ST\s?-?\d{2}(?:-\d)?|P\d{3}[A-Z0-9]*|SS\s?-?\d{3}|AISI\s?\d{3}|A\d{2,3}|1\.\d{4})\b/i;
export function findGrade(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) { const m = t ? GRADE_RE.exec(t) : null; if (m) return m[1].replace(/\s+/g, "").toUpperCase(); }
  return null;
}

/** Best-effort standard from the grade (EN steel names); "—" when it cannot be told. */
export function standardOf(grade: string, type: ReqType): string {
  const g = grade.toUpperCase();
  if (/^P\d{3}/.test(g)) return type === "Pipe" ? "EN 10217-1" : "EN 10028-2";
  if (/^S\d{3}/.test(g)) return type === "Profile" ? "EN 10025 / 10365" : type === "Flat" ? "EN 10025-2" : "EN 10025-2";
  if (/^ST/.test(g)) return "DIN 17100";
  if (/^(SS|AISI)/.test(g)) return "ASTM A240";
  return "—";
}

export function statusOf(shortage: number, available: number, ordered: number, received: number): ReqStatus {
  if (shortage <= EPS) return "AVAILABLE";
  if (ordered - received >= shortage - EPS && ordered > EPS) return "ORDERED"; // the missing part is already on order
  if (available <= EPS && ordered <= EPS) return "TO_ORDER";
  return "SHORTAGE";
}

export const STATUS_LABEL: Record<ReqStatus, string> = { AVAILABLE: "Available", SHORTAGE: "Shortage", TO_ORDER: "To Order", ORDERED: "On Order" };

export function summarize(rows: ReqRow[]) {
  const by = { AVAILABLE: 0, SHORTAGE: 0, TO_ORDER: 0, ORDERED: 0 } as Record<ReqStatus, number>;
  const types: Record<string, number> = {};
  for (const r of rows) { by[r.status]++; types[r.type] = (types[r.type] ?? 0) + 1; }
  return { total: rows.length, ...by, types };
}

export const sheetKg = (thicknessMm: number, widthMm: number, heightMm: number) => (widthMm * heightMm) / 1e6 * thicknessMm * STEEL_KG_PER_M2_MM;
