// Pure rules for procurement and stock (no Prisma / React) so they can be unit-tested.

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

// ----------------------------------------------------------------------------------------- numbering

/** PO-2026-0001 */
export const docNumber = (prefix: "PO" | "GR" | "WO", year: number, seq: number) => `${prefix}-${year}-${String(seq).padStart(4, "0")}`;

/** Next sequence number for the year, from the numbers that already exist (gaps are never refilled). */
export function nextSequence(existing: string[], prefix: "PO" | "GR" | "WO", year: number): number {
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  let max = 0;
  for (const n of existing) {
    const m = re.exec(n);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

// ----------------------------------------------------------------------------------------- ordering

/** What is still to be ordered for a material: the required quantity minus everything already ordered (never negative). */
export const remainingToOrder = (requiredQty: number, orders: { orderedQty: number }[]) =>
  r3(Math.max(0, requiredQty - orders.reduce((s, o) => s + o.orderedQty, 0)));

export interface PoLineInput { materialId: string; qty: number; unitPrice?: number | null }

/** First problem with a PO's lines, or null. */
export function validatePoLines(lines: PoLineInput[], known: Set<string>): string | null {
  if (!lines.length) return "Add at least one line";
  const seen = new Set<string>();
  for (const l of lines) {
    if (!known.has(l.materialId)) return "A line refers to a material that is not in this project";
    if (seen.has(l.materialId)) return "A material appears twice in the order";
    seen.add(l.materialId);
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) return "Every quantity must be greater than zero";
    if (l.unitPrice != null && (!Number.isFinite(l.unitPrice) || l.unitPrice < 0)) return "A unit price cannot be negative";
  }
  return null;
}

export const poTotal = (lines: { orderedQty: number; unitPrice: number | null }[]) =>
  r2(lines.reduce((s, l) => s + (l.unitPrice != null ? l.orderedQty * l.unitPrice : 0), 0));

// ----------------------------------------------------------------------------------------- receiving

export type PoState = "CANCELLED" | "NOT_RECEIVED" | "PARTIAL" | "RECEIVED";

export function poState(lines: { orderedQty: number; receivedQty: number }[], cancelled = false): PoState {
  if (cancelled) return "CANCELLED";
  const ordered = lines.reduce((s, l) => s + l.orderedQty, 0);
  const received = lines.reduce((s, l) => s + Math.min(l.receivedQty, l.orderedQty), 0);
  if (received <= 0) return "NOT_RECEIVED";
  return received >= ordered - 1e-9 ? "RECEIVED" : "PARTIAL";
}

/** Steel is rarely delivered to the exact weight: a delivery may exceed what is still open by this much. */
export const OVER_RECEIPT_TOLERANCE_PCT = 10;

export function receiptLimit(orderedQty: number, receivedQty: number, tolerancePct = OVER_RECEIPT_TOLERANCE_PCT) {
  return r3(Math.max(0, orderedQty * (1 + tolerancePct / 100) - receivedQty));
}

export interface ReceiptLineInput { orderId: string; qty: number; accepted?: boolean; heatNo?: string | null; certificateRef?: string | null }

/** First problem with a goods receipt, or null. `orders` = the PO's lines. */
export function validateReceipt(lines: ReceiptLineInput[], orders: Map<string, { orderedQty: number; receivedQty: number }>): string | null {
  if (!lines.length) return "Enter the received quantity of at least one line";
  const taken = new Map<string, number>();
  for (const l of lines) {
    const o = orders.get(l.orderId);
    if (!o) return "A line does not belong to this purchase order";
    if (!(l.qty > 0) || !Number.isFinite(l.qty)) return "Every received quantity must be greater than zero";
    if (l.accepted !== false) taken.set(l.orderId, (taken.get(l.orderId) ?? 0) + l.qty);
  }
  for (const [id, qty] of taken) {
    const o = orders.get(id)!;
    if (qty > receiptLimit(o.orderedQty, o.receivedQty) + 1e-9) return `More than ordered (limit ${receiptLimit(o.orderedQty, o.receivedQty)} including ${OVER_RECEIPT_TOLERANCE_PCT}% tolerance)`;
  }
  return null;
}

// ----------------------------------------------------------------------------------------- stock

export interface StockKeyFields { kind: string; material: string; thicknessMm: number; widthMm: number; heightMm: number; location?: string | null }

/** Identical sheets / remnants are one stock row with a quantity. A rectangle is the same either way round. */
export function stockKey(i: StockKeyFields): string {
  const [a, b] = [Math.round(i.widthMm), Math.round(i.heightMm)].sort((x, y) => y - x);
  return [i.kind, i.material.trim().toUpperCase(), r2(i.thicknessMm), a, b, (i.location ?? "").trim().toUpperCase()].join("|");
}

export function applyStockDelta(qty: number, delta: number): number {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("The quantity change must be a whole number other than zero");
  const next = qty + delta;
  if (next < 0) throw new Error(`Only ${qty} in stock`);
  return next;
}

export const STOCK_REASONS = ["ADDED", "REMNANT", "USED", "SCRAPPED", "ADJUSTED"] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

/** Weight in kg of one sheet / remnant (steel 7.85 kg per m² per mm). */
export const stockWeightKg = (i: { thicknessMm: number; widthMm: number; heightMm: number }) =>
  r2((i.widthMm / 1000) * (i.heightMm / 1000) * i.thicknessMm * 7.85);
