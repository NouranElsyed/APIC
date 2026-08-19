import { prisma } from "@/server/db/client";
import { computeTakeoffPart, buildDefaultAreaFormula } from "@/server/calc/takeoff";
import type { TakeoffDrawingInput, TakeoffPartInputData } from "@/server/validators/takeoff";
import { logActivity } from "./activity-log.service";

// computeTakeoffPart() returns a `formulaError` field for the UI's benefit —
// it isn't a persisted column, so it's stripped out before every write.
// The area formula is resolved to whatever was actually used (falling back
// to the type's default) so the stored value always matches the numbers,
// and stays editable Excel-style afterwards.
function persistedFields(data: TakeoffPartInputData) {
  const resolvedAreaFormula = data.partType === "HOT_ROLLED"
    ? null
    : (data.areaFormula?.trim() || buildDefaultAreaFormula(data.partType, data.geometry));
  const { formulaError: _formulaError, unitArea: _unitArea, ...computed } = computeTakeoffPart({
    partType: data.partType,
    geometry: data.geometry,
    qty: data.qty,
    thicknessMm: data.thicknessMm ?? null,
    paintSides: data.paintSides,
    areaFormula: resolvedAreaFormula,
    buyWeightKg: data.buyWeightKg,
  });
  return { resolvedAreaFormula, computed };
}

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
  const { resolvedAreaFormula, computed } = persistedFields(data);
  const part = await prisma.takeoffPart.create({
    data: {
      drawingId: data.drawingId,
      itemNo: data.itemNo,
      description: data.description,
      partType: data.partType,
      side: data.side,
      qty: data.qty,
      thicknessMm: data.thicknessMm ?? null,
      geometry: data.geometry,
      areaFormula: resolvedAreaFormula,
      paintSides: data.paintSides,
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

export async function updatePart(id: string, data: TakeoffPartInputData, userId: string) {
  const { resolvedAreaFormula, computed } = persistedFields(data);
  const part = await prisma.takeoffPart.update({
    where: { id },
    data: {
      itemNo: data.itemNo,
      description: data.description,
      partType: data.partType,
      side: data.side,
      qty: data.qty,
      thicknessMm: data.thicknessMm ?? null,
      geometry: data.geometry,
      areaFormula: resolvedAreaFormula,
      paintSides: data.paintSides,
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
