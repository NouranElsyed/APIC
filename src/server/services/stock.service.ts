// Sheets and remnants the company holds. Every change of quantity leaves a movement, so the stock can be explained.

import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { PlanningError } from "./planning.service";
import { applyStockDelta, stockKey, stockWeightKg, type StockReason } from "@/features/procurement/procurement";
import type { StockAdjustInput, StockCreateInput, StockFromNestInput } from "@/server/validators/procurement";

type Actor = { id: string; name: string };

export interface StockDTO {
  id: string; kind: "SHEET" | "REMNANT"; material: string; thicknessMm: number; widthMm: number; heightMm: number; qty: number;
  location: string | null; heatNo: string | null; notes: string | null; origin: string; originProjectId: string | null;
  /** weight of ONE piece, kg */
  weightKg: number; updatedAt: string;
}

const toDto = (s: {
  id: string; kind: "SHEET" | "REMNANT"; material: string; thicknessMm: number; widthMm: number; heightMm: number; qty: number;
  location: string | null; heatNo: string | null; notes: string | null; origin: string; originProjectId: string | null; updatedAt: Date;
}): StockDTO => ({ ...s, weightKg: stockWeightKg(s), updatedAt: s.updatedAt.toISOString() });

export async function listStock(filter: { includeEmpty?: boolean; thicknessMm?: number; material?: string } = {}): Promise<StockDTO[]> {
  const rows = await prisma.stockItem.findMany({
    where: {
      ...(filter.includeEmpty ? {} : { qty: { gt: 0 } }),
      ...(filter.thicknessMm ? { thicknessMm: filter.thicknessMm } : {}),
      ...(filter.material ? { material: { equals: filter.material, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ thicknessMm: "asc" }, { material: "asc" }, { widthMm: "desc" }],
    take: 1000,
  });
  return rows.map(toDto);
}

/** Adds to the stock; an identical row (same kind, material, thickness, size, location) just gets the quantity. */
export async function addStock(input: StockCreateInput, by: Actor, how: { reason: StockReason; origin: string; projectId?: string | null }) {
  const candidates = await prisma.stockItem.findMany({ where: { kind: input.kind, thicknessMm: input.thicknessMm, material: { equals: input.material, mode: "insensitive" } } });
  const key = stockKey(input);
  const same = candidates.find((c) => stockKey(c) === key);
  const note = how.origin === "NEST" ? "From nesting" : undefined;
  const item = await prisma.$transaction(async (tx) => {
    if (same) {
      const updated = await tx.stockItem.update({ where: { id: same.id }, data: { qty: applyStockDelta(same.qty, input.qty) } });
      await tx.stockMovement.create({ data: { stockItemId: same.id, delta: input.qty, reason: how.reason, projectId: how.projectId ?? null, userName: by.name, note } });
      return updated;
    }
    const created = await tx.stockItem.create({
      data: {
        kind: input.kind, material: input.material, thicknessMm: input.thicknessMm, widthMm: Math.max(input.widthMm, input.heightMm), heightMm: Math.min(input.widthMm, input.heightMm),
        qty: input.qty, location: input.location, heatNo: input.heatNo, notes: input.notes, origin: how.origin, originProjectId: how.projectId ?? null, createdById: by.id,
      },
    });
    await tx.stockMovement.create({ data: { stockItemId: created.id, delta: input.qty, reason: how.reason, projectId: how.projectId ?? null, userName: by.name, note } });
    return created;
  });
  await logActivity({ userId: by.id, action: "CREATE", entity: "STOCK_ITEM", entityId: item.id, detail: `${input.qty} × ${input.thicknessMm} mm ${input.widthMm}×${input.heightMm}` });
  return toDto(item);
}

export async function adjustStock(id: string, input: StockAdjustInput, by: Actor) {
  const cur = await prisma.stockItem.findUnique({ where: { id } });
  if (!cur) throw new PlanningError("Stock item not found", 404);
  let next: number;
  try { next = applyStockDelta(cur.qty, input.delta); } catch (e) { throw new PlanningError(e instanceof Error ? e.message : "Invalid quantity", 409); }
  const item = await prisma.$transaction(async (tx) => {
    const updated = await tx.stockItem.update({ where: { id }, data: { qty: next } });
    await tx.stockMovement.create({ data: { stockItemId: id, delta: input.delta, reason: input.reason, projectId: input.projectId ?? null, userName: by.name, note: input.note } });
    return updated;
  });
  await logActivity({ userId: by.id, action: "UPDATE", entity: "STOCK_ITEM", entityId: id, detail: `${input.delta > 0 ? "+" : ""}${input.delta} (${input.reason})` });
  return toDto(item);
}

/** Remnants found on a nest's sheets, added to the stock (grouped per size). */
export async function registerRemnants(input: StockFromNestInput, by: Actor) {
  let pieces = 0;
  for (const it of input.items) {
    await addStock({ kind: "REMNANT", material: it.material, thicknessMm: it.thicknessMm, widthMm: it.widthMm, heightMm: it.heightMm, qty: it.qty, location: input.location, heatNo: null, notes: null }, by, { reason: "REMNANT", origin: "NEST", projectId: input.projectId });
    pieces += it.qty;
  }
  return { lines: input.items.length, pieces };
}

export async function listMovements(stockItemId: string) {
  const rows = await prisma.stockMovement.findMany({ where: { stockItemId }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((m) => ({ id: m.id, delta: m.delta, reason: m.reason, projectId: m.projectId, note: m.note, userName: m.userName, createdAt: m.createdAt.toISOString() }));
}
