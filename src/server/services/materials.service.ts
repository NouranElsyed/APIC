// Material follow-up: project-wide list of what is needed, per phase, with the
// purchase orders raised against it and what has actually arrived.

import ExcelJS from "exceljs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { PlanningError } from "./planning.service";
import { dateToIso, isoToDate } from "@/features/planning/calendar";
import { parseMaterialSheet, norm } from "@/features/planning/materials-sheet";
import { byPhase, bySupplier, deriveMaterial, summarize, type MaterialDTO, type MaterialIn, type MaterialSummary, type PhaseRow, type SupplierRow } from "@/features/planning/materials";
import type { MaterialInput, OrderInput } from "@/server/validators/materials";

export interface MaterialsData {
  today: string;
  items: MaterialDTO[];
  summary: MaterialSummary;
  phases: PhaseRow[];
  suppliers: SupplierRow[];
  supplierNames: string[];
  wbsOptions: { id: string; label: string }[];
  activityOptions: { id: string; code: string; name: string }[];
  hasSchedule: boolean;
}

const i2 = (d: Date | null | undefined) => (d ? dateToIso(d) : null);
const d2 = (iso: string | null | undefined) => (iso ? isoToDate(iso) : null);
const todayIso = () => new Date().toISOString().slice(0, 10);

async function wbsLabels(projectId: string) {
  const sch = await prisma.planSchedule.findUnique({ where: { projectId }, select: { id: true } });
  if (!sch) return { scheduleId: null as string | null, labels: new Map<string, string>(), options: [] as { id: string; label: string }[] };
  const wbs = await prisma.planWbs.findMany({ where: { scheduleId: sch.id }, orderBy: { sortOrder: "asc" } });
  const byId = new Map(wbs.map((w) => [w.id, w]));
  const labelOf = (id: string): string => {
    const parts: string[] = [];
    for (let cur = byId.get(id), n = 0; cur && n < 20; cur = cur.parentId ? byId.get(cur.parentId) : undefined, n++) parts.unshift(cur.name);
    return parts.join(" › ");
  };
  const labels = new Map(wbs.map((w) => [w.id, labelOf(w.id)]));
  // Options in tree order.
  const options: { id: string; label: string }[] = [];
  const walk = (parent: string | null) => {
    for (const w of wbs.filter((x) => x.parentId === parent)) { options.push({ id: w.id, label: labels.get(w.id)! }); walk(w.id); }
  };
  walk(null);
  return { scheduleId: sch.id, labels, options };
}

export async function getMaterialsData(projectId: string): Promise<MaterialsData> {
  const [{ scheduleId, labels, options }, rows] = await Promise.all([
    wbsLabels(projectId),
    prisma.planMaterial.findMany({
      where: { projectId },
      include: { orders: { orderBy: [{ expectedDate: "asc" }, { createdAt: "asc" }] }, activity: { select: { code: true, earlyStart: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);
  const activities = scheduleId ? await prisma.planActivity.findMany({ where: { scheduleId }, select: { id: true, code: true, name: true }, orderBy: { sortOrder: "asc" } }) : [];
  const today = todayIso();

  const items = rows.map((m) => {
    const own = i2(m.neededBy);
    const fromActivity = i2(m.activity?.earlyStart);
    const input: MaterialIn = {
      id: m.id, code: m.code, description: m.description, spec: m.spec, unit: m.unit, requiredQty: m.requiredQty,
      neededBy: own ?? fromActivity, neededBySource: own ? "manual" : fromActivity ? "activity" : null,
      wbsId: m.wbsId, phase: m.wbsId ? labels.get(m.wbsId) ?? null : null,
      activityId: m.activityId, activityCode: m.activity?.code ?? null, notes: m.notes,
      orders: m.orders.map((o) => ({
        id: o.id, supplier: o.supplier, poNumber: o.poNumber, orderedQty: o.orderedQty, unitPrice: o.unitPrice,
        orderDate: i2(o.orderDate), expectedDate: i2(o.expectedDate), receivedQty: o.receivedQty, receivedDate: i2(o.receivedDate), notes: o.notes,
      })),
    };
    return deriveMaterial(input, today);
  });

  const supplierNames = [...new Set((await prisma.planMaterialOrder.findMany({ where: { material: { projectId } }, select: { supplier: true }, distinct: ["supplier"] })).map((s) => s.supplier))].sort();
  return {
    today, items, summary: summarize(items), phases: byPhase(items), suppliers: bySupplier(items), supplierNames,
    wbsOptions: options, activityOptions: activities, hasSchedule: !!scheduleId,
  };
}

// ----------------------------------------------------------------------------- CRUD

async function checkRefs(projectId: string, wbsId?: string | null, activityId?: string | null) {
  if (wbsId && !(await prisma.planWbs.findFirst({ where: { id: wbsId, schedule: { projectId } }, select: { id: true } }))) throw new PlanningError("Phase (WBS) not found in this project's schedule.");
  if (activityId && !(await prisma.planActivity.findFirst({ where: { id: activityId, schedule: { projectId } }, select: { id: true } }))) throw new PlanningError("Activity not found in this project's schedule.");
}

async function materialOrThrow(projectId: string, materialId: string) {
  const m = await prisma.planMaterial.findFirst({ where: { id: materialId, projectId } });
  if (!m) throw new PlanningError("Material not found", 404);
  return m;
}

export async function createMaterial(projectId: string, input: MaterialInput, userId: string) {
  if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw new PlanningError("Project not found", 404);
  await checkRefs(projectId, input.wbsId, input.activityId);
  const max = await prisma.planMaterial.aggregate({ where: { projectId }, _max: { sortOrder: true } });
  const m = await prisma.planMaterial.create({
    data: {
      projectId, createdById: userId, description: input.description, code: input.code || null, spec: input.spec || null, unit: input.unit ?? "kg",
      requiredQty: input.requiredQty, neededBy: d2(input.neededBy), wbsId: input.wbsId || null, activityId: input.activityId || null,
      notes: input.notes || null, sortOrder: (max._max.sortOrder ?? 0) + 1,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "PLAN_MATERIAL", entityId: m.id, detail: m.description });
  return m;
}

export async function updateMaterial(projectId: string, materialId: string, input: MaterialInput, userId: string) {
  const cur = await materialOrThrow(projectId, materialId);
  await checkRefs(projectId, input.wbsId, input.activityId);
  await prisma.planMaterial.update({
    where: { id: materialId },
    data: {
      description: input.description, code: input.code === undefined ? cur.code : input.code || null, spec: input.spec === undefined ? cur.spec : input.spec || null,
      unit: input.unit ?? cur.unit, requiredQty: input.requiredQty,
      neededBy: input.neededBy === undefined ? cur.neededBy : d2(input.neededBy),
      wbsId: input.wbsId === undefined ? cur.wbsId : input.wbsId || null,
      activityId: input.activityId === undefined ? cur.activityId : input.activityId || null,
      notes: input.notes === undefined ? cur.notes : input.notes || null,
    },
  });
  await logActivity({ userId, action: "UPDATE", entity: "PLAN_MATERIAL", entityId: materialId, detail: input.description });
}

export async function deleteMaterial(projectId: string, materialId: string, userId: string) {
  const cur = await materialOrThrow(projectId, materialId);
  await prisma.planMaterial.delete({ where: { id: materialId } });
  await logActivity({ userId, action: "DELETE", entity: "PLAN_MATERIAL", entityId: materialId, detail: cur.description });
}

const orderData = (input: OrderInput) => ({
  supplier: input.supplier, poNumber: input.poNumber || null, orderedQty: input.orderedQty, unitPrice: input.unitPrice ?? null,
  orderDate: d2(input.orderDate), expectedDate: d2(input.expectedDate), notes: input.notes || null,
});

export async function createOrder(projectId: string, materialId: string, input: OrderInput, userId: string) {
  const m = await materialOrThrow(projectId, materialId);
  const received = input.receivedQty ?? 0;
  if (received > input.orderedQty) throw new PlanningError("Received quantity cannot exceed the ordered quantity.");
  const o = await prisma.planMaterialOrder.create({
    data: { materialId, ...orderData(input), receivedQty: received, receivedDate: received > 0 ? d2(input.receivedDate ?? todayIso()) : null },
  });
  await logActivity({ userId, action: "CREATE", entity: "PLAN_MATERIAL", entityId: m.id, detail: `PO ${input.poNumber ?? "—"} · ${input.supplier} · ${input.orderedQty} ${m.unit}` });
  return o;
}

async function orderOrThrow(projectId: string, materialId: string, orderId: string) {
  const o = await prisma.planMaterialOrder.findFirst({ where: { id: orderId, materialId, material: { projectId } }, include: { material: true } });
  if (!o) throw new PlanningError("Order not found", 404);
  return o;
}

export async function updateOrder(projectId: string, materialId: string, orderId: string, input: OrderInput, userId: string) {
  const cur = await orderOrThrow(projectId, materialId, orderId);
  const received = input.receivedQty ?? cur.receivedQty;
  if (received > input.orderedQty + 1e-9) throw new PlanningError("Received quantity cannot exceed the ordered quantity.");
  const receivedChanged = received !== cur.receivedQty;
  await prisma.planMaterialOrder.update({
    where: { id: orderId },
    data: {
      ...orderData(input), receivedQty: received,
      receivedDate: received <= 0 ? null : input.receivedDate !== undefined ? d2(input.receivedDate) : receivedChanged ? d2(todayIso()) : cur.receivedDate,
    },
  });
  await logActivity({ userId, action: "UPDATE", entity: "PLAN_MATERIAL", entityId: materialId, detail: `${receivedChanged ? `Received ${received}/${input.orderedQty} ${cur.material.unit}` : "Order updated"} · ${input.supplier}` });
}

export async function deleteOrder(projectId: string, materialId: string, orderId: string, userId: string) {
  const cur = await orderOrThrow(projectId, materialId, orderId);
  await prisma.planMaterialOrder.delete({ where: { id: orderId } });
  await logActivity({ userId, action: "DELETE", entity: "PLAN_MATERIAL", entityId: materialId, detail: `Order removed · ${cur.supplier}` });
}

// -------------------------------------------------------------------- Excel in / out

export interface MaterialImportReport { created: number; skipped: number; warnings: string[] }

export async function importMaterialsFromExcel(projectId: string, buffer: ArrayBuffer, userId: string): Promise<MaterialImportReport> {
  if (!(await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }))) throw new PlanningError("Project not found", 404);
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new PlanningError("Could not read this file — upload an .xlsx workbook."); }
  const ws = wb.worksheets[0];
  if (!ws) throw new PlanningError("The workbook is empty.");

  const { scheduleId, labels } = await wbsLabels(projectId);
  const wbsRows = scheduleId ? await prisma.planWbs.findMany({ where: { scheduleId }, select: { id: true, code: true, name: true } }) : [];
  const acts = scheduleId ? await prisma.planActivity.findMany({ where: { scheduleId }, select: { id: true, code: true } }) : [];
  const actByCode = new Map(acts.map((a) => [norm(a.code), a.id]));
  const parsed = parseMaterialSheet(ws, {
    wbs: (t) => { const n = norm(t); return wbsRows.find((w) => norm(w.code) === n || norm(w.name) === n || norm(labels.get(w.id)) === n)?.id ?? null; },
    activity: (t) => actByCode.get(norm(t)) ?? null,
  });
  if ("error" in parsed) throw new PlanningError(parsed.error);

  const max = await prisma.planMaterial.aggregate({ where: { projectId }, _max: { sortOrder: true } });
  let order = max._max.sortOrder ?? 0;
  const warnings: string[] = [];
  const skipped = parsed.skipped;
  const { badPhase, badActivity, badDate } = parsed;
  const rows: Prisma.PlanMaterialCreateManyInput[] = parsed.rows.map((r) => ({
    projectId, createdById: userId, description: r.description, spec: r.spec, unit: r.unit, requiredQty: r.requiredQty,
    wbsId: r.wbsId, activityId: r.activityId, neededBy: d2(r.neededBy), code: r.code, notes: r.notes, sortOrder: ++order,
  }));
  if (rows.length === 0) throw new PlanningError("No valid rows found. Each row needs a description and a quantity.");
  await prisma.planMaterial.createMany({ data: rows });
  if (skipped) warnings.push(`${skipped} rows skipped (missing description or invalid quantity).`);
  if (badPhase) warnings.push(`${badPhase} rows have a phase that does not match any WBS element — imported without a phase.`);
  if (badActivity) warnings.push(`${badActivity} rows have an unknown Activity ID — imported without a link.`);
  if (badDate) warnings.push(`${badDate} rows have an unreadable 'Needed by' date (use YYYY-MM-DD).`);
  await logActivity({ userId, action: "CREATE", entity: "PLAN_MATERIAL", entityId: projectId, detail: `Imported ${rows.length} materials from Excel` });
  return { created: rows.length, skipped, warnings };
}
