import { prisma } from "@/server/db/client";
import { computeTakeoffPart } from "@/server/calc/takeoff";
import type { TakeoffDrawingInput, TakeoffPartInputData } from "@/server/validators/takeoff";
import { logActivity } from "./activity-log.service";

export async function listDrawingsForProject(projectId: string) {
  return prisma.takeoffDrawing.findMany({
    where: { projectId },
    include: { parts: { orderBy: { itemNo: "asc" } } },
    orderBy: { sortOrder: "asc" },
  });
}

export async function createDrawing(data: TakeoffDrawingInput, userId: string) {
  const count = await prisma.takeoffDrawing.count({ where: { projectId: data.projectId } });
  const drawing = await prisma.takeoffDrawing.create({
    data: {
      projectId: data.projectId,
      drawingNumber: data.drawingNumber,
      title: data.title,
      weightFromDwg: data.weightFromDwg ?? null,
      sortOrder: count,
    },
  });
  await logActivity({
    userId,
    action: "CREATE",
    entity: "TAKEOFF_DRAWING",
    entityId: drawing.id,
    detail: `${drawing.drawingNumber} — ${drawing.title}`,
  });
  return drawing;
}

export async function deleteDrawing(id: string, userId: string) {
  const drawing = await prisma.takeoffDrawing.delete({ where: { id } });
  await logActivity({
    userId,
    action: "DELETE",
    entity: "TAKEOFF_DRAWING",
    entityId: id,
    detail: `${drawing.drawingNumber} — ${drawing.title}`,
  });
  return drawing;
}

export async function createPart(data: TakeoffPartInputData, userId: string) {
  const computed = computeTakeoffPart(data);
  const part = await prisma.takeoffPart.create({
    data: {
      drawingId: data.drawingId,
      itemNo: data.itemNo,
      description: data.description,
      extWidth: data.extWidth ?? null,
      extLength: data.extLength ?? null,
      intWidth: data.intWidth ?? null,
      intLength: data.intLength ?? null,
      qty: data.qty,
      thicknessMm: data.thicknessMm,
      paintSides: data.paintSides,
      areaMode: data.areaMode,
      ...computed,
    },
  });
  await logActivity({
    userId,
    action: "CREATE",
    entity: "TAKEOFF_PART",
    entityId: part.id,
    detail: part.description,
  });
  return part;
}

// Excel-style grid entry: create many parts under one drawing in a single
// call, in the order given. Each row is computed the same way as a single
// createPart (server-side recompute, never trusts client-sent totals).
export async function createPartsBulk(drawingId: string, rows: Omit<TakeoffPartInputData, "drawingId">[], userId: string) {
  const created = [];
  for (const row of rows) {
    const computed = computeTakeoffPart(row);
    const part = await prisma.takeoffPart.create({
      data: {
        drawingId,
        itemNo: row.itemNo,
        description: row.description,
        extWidth: row.extWidth ?? null,
        extLength: row.extLength ?? null,
        intWidth: row.intWidth ?? null,
        intLength: row.intLength ?? null,
        qty: row.qty,
        thicknessMm: row.thicknessMm,
        paintSides: row.paintSides,
        areaMode: row.areaMode,
        ...computed,
      },
    });
    created.push(part);
  }
  await logActivity({
    userId,
    action: "CREATE",
    entity: "TAKEOFF_PART",
    entityId: drawingId,
    detail: `Grid entry: added ${created.length} part(s)`,
  });
  return created;
}

export async function updatePart(id: string, data: TakeoffPartInputData, userId: string) {
  const computed = computeTakeoffPart(data);
  const part = await prisma.takeoffPart.update({
    where: { id },
    data: {
      itemNo: data.itemNo,
      description: data.description,
      extWidth: data.extWidth ?? null,
      extLength: data.extLength ?? null,
      intWidth: data.intWidth ?? null,
      intLength: data.intLength ?? null,
      qty: data.qty,
      thicknessMm: data.thicknessMm,
      paintSides: data.paintSides,
      areaMode: data.areaMode,
      ...computed,
    },
  });
  await logActivity({
    userId,
    action: "UPDATE",
    entity: "TAKEOFF_PART",
    entityId: part.id,
    detail: part.description,
  });
  return part;
}

export async function deletePart(id: string, userId: string) {
  const part = await prisma.takeoffPart.delete({ where: { id } });
  await logActivity({
    userId,
    action: "DELETE",
    entity: "TAKEOFF_PART",
    entityId: id,
    detail: part.description,
  });
  return part;
}
