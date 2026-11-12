// Material follow-up maths (pure). A material's status is always derived from its
// purchase orders and the needed-by date — it is never stored.

import { isoToDay } from "./calendar";

export type MaterialStatus = "NOT_ORDERED" | "ORDERED" | "PARTIAL" | "DELIVERED" | "LATE";

export interface OrderIn {
  id: string;
  supplier: string;
  poNumber: string | null;
  orderedQty: number;
  unitPrice: number | null;
  orderDate: string | null;
  expectedDate: string | null;
  receivedQty: number;
  receivedDate: string | null;
  notes: string | null;
}

export interface MaterialIn {
  id: string;
  code: string | null;
  description: string;
  spec: string | null;
  unit: string;
  requiredQty: number;
  /** Effective needed-by date (the material's own date, else the linked activity's start). */
  neededBy: string | null;
  neededBySource: "manual" | "activity" | null;
  wbsId: string | null;
  phase: string | null;
  activityId: string | null;
  activityCode: string | null;
  notes: string | null;
  orders: OrderIn[];
}

export interface OrderDTO extends OrderIn {
  late: boolean;
  value: number | null;
}

export interface MaterialDTO extends Omit<MaterialIn, "orders"> {
  orders: OrderDTO[];
  orderedQty: number;
  receivedQty: number;
  /** Quantity still to be ordered (never negative). */
  toOrder: number;
  /** Quantity ordered but not yet received. */
  inTransit: number;
  /** 0–100, how much of the requirement has arrived. */
  percentReceived: number;
  status: MaterialStatus;
  /** Not fully ordered and needed within the lead window (or already overdue). */
  urgent: boolean;
  /** Days until needed-by (negative = overdue); null without a date. */
  daysToNeeded: number | null;
  suppliers: string[];
  orderedValue: number | null;
}

const EPS = 1e-6;
const URGENT_WINDOW_DAYS = 14;
const round = (n: number, p = 100) => Math.round(n * p) / p;

export function deriveMaterial(m: MaterialIn, today: string): MaterialDTO {
  const t = isoToDay(today);
  const orders: OrderDTO[] = m.orders.map((o) => ({
    ...o,
    late: !!o.expectedDate && isoToDay(o.expectedDate) < t && o.receivedQty < o.orderedQty - EPS,
    value: o.unitPrice != null ? round(o.orderedQty * o.unitPrice) : null,
  }));
  const orderedQty = orders.reduce((s, o) => s + o.orderedQty, 0);
  const receivedQty = orders.reduce((s, o) => s + o.receivedQty, 0);
  const required = Math.max(0, m.requiredQty);
  const delivered = required > 0 ? receivedQty >= required - EPS : orders.length > 0 && receivedQty >= orderedQty - EPS;
  const daysToNeeded = m.neededBy ? isoToDay(m.neededBy) - t : null;

  let status: MaterialStatus;
  if (delivered) status = "DELIVERED";
  else if (orders.length === 0) status = "NOT_ORDERED";
  else if (orders.some((o) => o.late)) status = "LATE";
  else if (receivedQty > EPS) status = "PARTIAL";
  else status = "ORDERED";

  const toOrder = Math.max(0, required - orderedQty);
  const priced = orders.filter((o) => o.value != null);
  return {
    ...m,
    orders,
    orderedQty: round(orderedQty, 1000),
    receivedQty: round(receivedQty, 1000),
    toOrder: round(toOrder, 1000),
    inTransit: round(Math.max(0, orderedQty - receivedQty), 1000),
    percentReceived: required > 0 ? round(Math.min(100, (receivedQty / required) * 100), 10) : delivered ? 100 : 0,
    status,
    urgent: toOrder > EPS && daysToNeeded != null && daysToNeeded <= URGENT_WINDOW_DAYS,
    daysToNeeded,
    suppliers: [...new Set(orders.map((o) => o.supplier).filter(Boolean))],
    orderedValue: priced.length ? round(priced.reduce((s, o) => s + (o.value ?? 0), 0)) : null,
  };
}

export interface MaterialSummary {
  total: number;
  byStatus: Record<MaterialStatus, number>;
  urgent: number;
  /** Average of each item's received %, i.e. overall delivery progress of the whole list. */
  percentDelivered: number;
  /** Ordered value in the project currency, only for orders that have a price. */
  orderedValue: number;
  nextDue: { id: string; description: string; neededBy: string; daysToNeeded: number } | null;
}

export function summarize(items: MaterialDTO[]): MaterialSummary {
  const byStatus: Record<MaterialStatus, number> = { NOT_ORDERED: 0, ORDERED: 0, PARTIAL: 0, DELIVERED: 0, LATE: 0 };
  for (const m of items) byStatus[m.status]++;
  const open = items.filter((m) => m.status !== "DELIVERED" && m.neededBy && m.daysToNeeded != null).sort((a, b) => a.daysToNeeded! - b.daysToNeeded!);
  return {
    total: items.length,
    byStatus,
    urgent: items.filter((m) => m.urgent).length,
    percentDelivered: items.length ? round(items.reduce((s, m) => s + m.percentReceived, 0) / items.length, 10) : 0,
    orderedValue: round(items.reduce((s, m) => s + (m.orderedValue ?? 0), 0)),
    nextDue: open[0] ? { id: open[0].id, description: open[0].description, neededBy: open[0].neededBy!, daysToNeeded: open[0].daysToNeeded! } : null,
  };
}

export interface PhaseRow { phase: string; total: number; delivered: number; notOrdered: number; late: number; percent: number }

export function byPhase(items: MaterialDTO[]): PhaseRow[] {
  const map = new Map<string, MaterialDTO[]>();
  for (const m of items) (map.get(m.phase ?? "No phase") ?? map.set(m.phase ?? "No phase", []).get(m.phase ?? "No phase")!).push(m);
  return [...map.entries()].map(([phase, list]) => ({
    phase, total: list.length,
    delivered: list.filter((m) => m.status === "DELIVERED").length,
    notOrdered: list.filter((m) => m.status === "NOT_ORDERED").length,
    late: list.filter((m) => m.status === "LATE").length,
    percent: round(list.reduce((s, m) => s + m.percentReceived, 0) / list.length, 10),
  }));
}

export interface SupplierRow { supplier: string; orders: number; items: number; value: number; late: number; pendingQtyOrders: number }

export function bySupplier(items: MaterialDTO[]): SupplierRow[] {
  const map = new Map<string, SupplierRow & { _items: Set<string> }>();
  for (const m of items) {
    for (const o of m.orders) {
      const key = o.supplier || "Unknown";
      const r = map.get(key) ?? map.set(key, { supplier: key, orders: 0, items: 0, value: 0, late: 0, pendingQtyOrders: 0, _items: new Set() }).get(key)!;
      r.orders++;
      r._items.add(m.id);
      r.value = round(r.value + (o.value ?? 0));
      if (o.late) r.late++;
      if (o.receivedQty < o.orderedQty - EPS) r.pendingQtyOrders++;
    }
  }
  return [...map.values()].map(({ _items, ...r }) => ({ ...r, items: _items.size })).sort((a, b) => b.value - a.value || a.supplier.localeCompare(b.supplier));
}
