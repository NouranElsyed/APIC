// Production tracking: work orders per takeoff part, pieces followed through cutting → assembly → welding → painting,
// and the progress by weight that drives the schedule's fabrication activities (so the S-curve "actual" is fed by the shop).

import { ensureNestInSync } from "./nest-sync-guard";
import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { PlanningError, applyProgress } from "./planning.service";
import { dateToIso, isoToDate } from "@/features/planning/calendar";
import { docNumber, nextSequence } from "@/features/procurement/procurement";
import {
  STAGES, STAGE_FIELD, STAGE_LABEL, canComplete, canUndo, descendantWbsIds, parsePieceCode, pickEligible, pieceCode, pieceProgress, projectProduction,
  unitWeight, workOrderStats, type ProjectProduction, type Stage, type WorkOrderStats,
} from "@/features/production/production";

type Actor = { id: string; name: string };
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
const MAX_PIECES = 5000;
const todayIso = () => new Date().toISOString().slice(0, 10);

export interface WorkOrderDTO {
  id: string; number: string; description: string; partNo: number | null; material: string | null; qty: number; unitWeightKg: number;
  dueDate: string | null; stats: WorkOrderStats;
}
export interface UnreleasedPart { id: string; itemNo: number; description: string; qty: number; weightKg: number; material: string | null }
export interface ProductionData {
  project: { id: string; number: string; name: string };
  summary: ProjectProduction;
  orders: WorkOrderDTO[];
  /** takeoff parts that have no work order yet */
  unreleased: UnreleasedPart[];
  schedule: { exists: boolean; wbs: { id: string; code: string; name: string; level: number }[]; linkedWbsId: string | null; linkedActivities: number };
}

const pieceSelect = { id: true, seq: true, cutAt: true, assembledAt: true, weldedAt: true, paintedAt: true } as const;

async function projectTotalKg(projectId: string) {
  const agg = await prisma.takeoffPart.aggregate({ where: { drawing: { projectId }, partType: { not: "ACCESSORY" } }, _sum: { weightKg: true } });
  return agg._sum.weightKg ?? 0;
}

export async function getProduction(projectId: string): Promise<ProductionData | null> {
  await ensureNestInSync(projectId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, number: true, name: true, productionWbsId: true } });
  if (!project) return null;

  const [orders, parts, totalKg, schedule] = await Promise.all([
    prisma.workOrder.findMany({ where: { projectId }, include: { pieces: { select: pieceSelect } }, orderBy: { number: "asc" } }),
    prisma.takeoffPart.findMany({ where: { drawing: { projectId }, partType: { not: "ACCESSORY" } }, select: { id: true, itemNo: true, description: true, qty: true, weightKg: true, material: true }, orderBy: { itemNo: "asc" } }),
    projectTotalKg(projectId),
    prisma.planSchedule.findUnique({ where: { projectId }, select: { wbs: { select: { id: true, code: true, name: true, parentId: true, sortOrder: true }, orderBy: [{ code: "asc" }] }, activities: { select: { id: true, type: true, wbsId: true } } } }),
  ]);

  const released = new Set(orders.map((o) => o.partId).filter(Boolean) as string[]);
  const wbs = schedule?.wbs ?? [];
  const depth = (id: string | null): number => { let d = 0; let cur = wbs.find((w) => w.id === id); while (cur?.parentId) { d++; cur = wbs.find((w) => w.id === cur!.parentId); } return d; };
  const linked = project.productionWbsId && wbs.some((w) => w.id === project.productionWbsId) ? project.productionWbsId : null;
  const ids = linked ? descendantWbsIds(wbs, linked) : new Set<string>();

  return {
    project: { id: project.id, number: project.number, name: project.name },
    summary: projectProduction(orders.map((o) => ({ unitWeightKg: o.unitWeightKg, pieces: o.pieces })), totalKg),
    orders: orders.map((o) => ({
      id: o.id, number: o.number, description: o.description, partNo: o.partNo, material: o.material, qty: o.qty, unitWeightKg: o.unitWeightKg,
      dueDate: o.dueDate ? dateToIso(o.dueDate) : null, stats: workOrderStats(o.pieces, o.unitWeightKg),
    })),
    unreleased: parts.filter((p) => !released.has(p.id)),
    schedule: {
      exists: !!schedule,
      wbs: wbs.map((w) => ({ id: w.id, code: w.code, name: w.name, level: depth(w.id) })),
      linkedWbsId: linked,
      linkedActivities: schedule ? schedule.activities.filter((a) => a.type === "TASK" && a.wbsId && ids.has(a.wbsId)).length : 0,
    },
  };
}

// ------------------------------------------------------------------------------------------ creating work orders

async function createOne(projectId: string, part: { id: string; itemNo: number; description: string; qty: number; weightKg: number; material: string | null }, dueDate: Date | null, by: Actor) {
  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await prisma.workOrder.findMany({ where: { number: { startsWith: `WO-${year}-` } }, select: { number: true } });
    const number = docNumber("WO", year, nextSequence(rows.map((r) => r.number), "WO", year));
    try {
      return await prisma.workOrder.create({
        data: {
          number, description: part.description, partNo: part.itemNo, partId: part.id, material: part.material, qty: part.qty, unitWeightKg: unitWeight(part.weightKg, part.qty),
          dueDate, createdById: by.id, createdByName: by.name, projectId,
          pieces: { create: Array.from({ length: part.qty }, (_, i) => ({ seq: i + 1 })) },
        },
      });
    } catch (e) { if (!isUnique(e) || attempt === 3) throw e; }
  }
  throw new PlanningError("Could not allocate a work order number", 500);
}

/** One work order per takeoff part that has none yet (all of them, or the given ones). */
export async function createWorkOrders(projectId: string, opts: { partIds?: string[]; dueDate?: string | null }, by: Actor) {
  await ensureNestInSync(projectId);
  const parts = await prisma.takeoffPart.findMany({ where: { drawing: { projectId }, partType: { not: "ACCESSORY" }, ...(opts.partIds ? { id: { in: opts.partIds } } : {}) }, select: { id: true, itemNo: true, description: true, qty: true, weightKg: true, material: true }, orderBy: { itemNo: "asc" } });
  const existing = await prisma.workOrder.findMany({ where: { projectId, partId: { in: parts.map((p) => p.id) } }, select: { partId: true } });
  const have = new Set(existing.map((e) => e.partId));
  const todo = parts.filter((p) => !have.has(p.id) && p.qty > 0);
  const tooBig = todo.find((p) => p.qty > MAX_PIECES);
  if (tooBig) throw new PlanningError(`Part ${tooBig.itemNo} has ${tooBig.qty} pieces; a work order is limited to ${MAX_PIECES}.`, 409);
  if (!todo.length) throw new PlanningError("Every part already has a work order", 409);

  const due = opts.dueDate ? isoToDate(opts.dueDate) : null;
  for (const p of todo) await createOne(projectId, p, due, by);
  await logActivity({ userId: by.id, action: "CREATE", entity: "WORK_ORDER", entityId: projectId, detail: `${todo.length} work order${todo.length === 1 ? "" : "s"}` });
  return { created: todo.length, pieces: todo.reduce((s, p) => s + p.qty, 0) };
}

export async function deleteWorkOrder(id: string, userId: string) {
  const wo = await prisma.workOrder.findUnique({ where: { id }, include: { pieces: { select: pieceSelect } } });
  if (!wo) throw new PlanningError("Work order not found", 404);
  if (wo.pieces.some((p) => pieceProgress(p) > 0)) throw new PlanningError("Work has already started on this order, so it cannot be deleted.", 409);
  await prisma.workOrder.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "WORK_ORDER", entityId: id, detail: wo.number });
}

// ------------------------------------------------------------------------------------------ progress

export interface SyncResult { synced: boolean; updated: number; percent: number; reason?: string }

/**
 * Pushes the production percentage (tons made ÷ total tons) into the schedule: every task under the linked WBS gets that
 * percent complete, through the normal progress update, which also records the S-curve "actual" point for today.
 */
export async function syncScheduleFromProduction(projectId: string, userId: string): Promise<SyncResult> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { productionWbsId: true } });
  const totalKg = await projectTotalKg(projectId);
  const orders = await prisma.workOrder.findMany({ where: { projectId }, select: { unitWeightKg: true, pieces: { select: pieceSelect } } });
  const percent = projectProduction(orders, totalKg).percent;
  if (!project?.productionWbsId) return { synced: false, updated: 0, percent, reason: "No schedule activities are linked to production yet." };

  const schedule = await prisma.planSchedule.findUnique({ where: { projectId }, select: { wbs: { select: { id: true, parentId: true } }, activities: { select: { id: true, type: true, wbsId: true, percentComplete: true } } } });
  if (!schedule) return { synced: false, updated: 0, percent, reason: "The project has no schedule." };
  if (!schedule.wbs.some((w) => w.id === project.productionWbsId)) return { synced: false, updated: 0, percent, reason: "The linked WBS no longer exists." };

  const ids = descendantWbsIds(schedule.wbs, project.productionWbsId);
  const acts = schedule.activities.filter((a) => a.type === "TASK" && a.wbsId && ids.has(a.wbsId));
  if (!acts.length) return { synced: false, updated: 0, percent, reason: "The linked WBS has no activities." };
  const updates = acts.filter((a) => Math.abs(a.percentComplete - percent) > 0.05).map((a) => ({ activityId: a.id, percentComplete: percent }));
  if (!updates.length) return { synced: true, updated: 0, percent };
  await applyProgress(projectId, { dataDate: todayIso(), updates }, userId);
  return { synced: true, updated: updates.length, percent };
}

async function after(projectId: string, by: Actor): Promise<SyncResult> {
  try { return await syncScheduleFromProduction(projectId, by.id); }
  catch (e) { return { synced: false, updated: 0, percent: 0, reason: e instanceof Error ? e.message : "Could not update the schedule" }; }
}

/** Finishes `stage` on the next `count` pieces of an order that are ready for it (in piece-number order). */
export async function advanceStage(workOrderId: string, stage: Stage, count: number, by: Actor) {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, include: { pieces: { select: pieceSelect } } });
  if (!wo) throw new PlanningError("Work order not found", 404);
  const picked = pickEligible(wo.pieces, stage, count);
  if (picked.length < count) {
    throw new PlanningError(picked.length === 0 ? `No piece is ready for ${STAGE_LABEL[stage].toLowerCase()} yet.` : `Only ${picked.length} piece${picked.length === 1 ? " is" : "s are"} ready for ${STAGE_LABEL[stage].toLowerCase()}.`, 409);
  }
  const now = new Date();
  await prisma.workOrderPiece.updateMany({ where: { id: { in: picked.map((p) => p.id!) } }, data: { [STAGE_FIELD[stage]]: now } });
  await logActivity({ userId: by.id, action: "UPDATE", entity: "WORK_ORDER", entityId: workOrderId, detail: `${wo.number}: ${count} × ${STAGE_LABEL[stage]}` });
  return { advanced: picked.length, sync: await after(wo.projectId, by) };
}

// ------------------------------------------------------------------------------------------ one piece (QR scan)

export interface PieceDTO {
  code: string; seq: number; qty: number; progress: number; weightKg: number;
  workOrder: { id: string; number: string; description: string; partNo: number | null; material: string | null; dueDate: string | null };
  project: { id: string; number: string; name: string };
  stages: { stage: Stage; label: string; doneAt: string | null; canComplete: boolean; canUndo: boolean }[];
}

export async function getPiece(code: string): Promise<PieceDTO | null> {
  const parsed = parsePieceCode(code);
  if (!parsed) return null;
  const piece = await prisma.workOrderPiece.findFirst({
    where: { seq: parsed.seq, workOrder: { number: parsed.number } },
    include: { workOrder: { include: { project: { select: { id: true, number: true, name: true } } } } },
  });
  if (!piece) return null;
  const wo = piece.workOrder;
  return {
    code: pieceCode(wo.number, piece.seq), seq: piece.seq, qty: wo.qty, progress: pieceProgress(piece), weightKg: Math.round(wo.unitWeightKg * 100) / 100,
    workOrder: { id: wo.id, number: wo.number, description: wo.description, partNo: wo.partNo, material: wo.material, dueDate: wo.dueDate ? dateToIso(wo.dueDate) : null },
    project: wo.project,
    stages: STAGES.map((s) => ({ stage: s, label: STAGE_LABEL[s], doneAt: piece[STAGE_FIELD[s]]?.toISOString() ?? null, canComplete: canComplete(piece, s), canUndo: canUndo(piece, s) })),
  };
}

export async function updatePiece(code: string, stage: Stage, action: "complete" | "undo", by: Actor) {
  const parsed = parsePieceCode(code);
  const piece = parsed ? await prisma.workOrderPiece.findFirst({ where: { seq: parsed.seq, workOrder: { number: parsed.number } }, include: { workOrder: { select: { id: true, number: true, projectId: true } } } }) : null;
  if (!piece) throw new PlanningError("Piece not found", 404);
  if (action === "complete" && !canComplete(piece, stage)) throw new PlanningError(`This piece is not ready for ${STAGE_LABEL[stage].toLowerCase()}.`, 409);
  if (action === "undo" && !canUndo(piece, stage)) throw new PlanningError(`${STAGE_LABEL[stage]} cannot be undone on this piece.`, 409);
  await prisma.workOrderPiece.update({ where: { id: piece.id }, data: { [STAGE_FIELD[stage]]: action === "complete" ? new Date() : null } });
  await logActivity({ userId: by.id, action: "UPDATE", entity: "WORK_ORDER", entityId: piece.workOrder.id, detail: `${pieceCode(piece.workOrder.number, piece.seq)}: ${action === "complete" ? "" : "undo "}${STAGE_LABEL[stage]}` });
  return { piece: await getPiece(pieceCode(piece.workOrder.number, piece.seq)), sync: await after(piece.workOrder.projectId, by) };
}

/** Pieces of an order, for the label sheet. */
export async function listPieceCodes(workOrderId: string) {
  const wo = await prisma.workOrder.findUnique({ where: { id: workOrderId }, include: { pieces: { select: { seq: true }, orderBy: { seq: "asc" } }, project: { select: { number: true, name: true } } } });
  if (!wo) return null;
  return { number: wo.number, description: wo.description, partNo: wo.partNo, material: wo.material, weightKg: Math.round(wo.unitWeightKg * 100) / 100, project: wo.project, codes: wo.pieces.map((p) => pieceCode(wo.number, p.seq)) };
}

// ------------------------------------------------------------------------------------------ link to the schedule

export async function setProductionWbs(projectId: string, wbsId: string | null, userId: string) {
  if (wbsId) {
    const w = await prisma.planWbs.findFirst({ where: { id: wbsId, schedule: { projectId } }, select: { id: true } });
    if (!w) throw new PlanningError("That WBS is not part of this project's schedule", 404);
  }
  await prisma.project.update({ where: { id: projectId }, data: { productionWbsId: wbsId } });
  await logActivity({ userId, action: "UPDATE", entity: "PROJECT", entityId: projectId, detail: wbsId ? "Production linked to the schedule" : "Production unlinked from the schedule" });
  return wbsId ? await syncScheduleFromProduction(projectId, userId) : null;
}
