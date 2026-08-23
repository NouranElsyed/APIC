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
    include: { parts: { orderBy: { itemNo: "asc" }, include: { dxf: true } } },
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
      material: data.material ?? null,
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
      material: data.material ?? null,
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

// Narrow, dependency-light check for a Prisma known-request-error code —
// avoids importing the `Prisma` namespace class just for an instanceof
// check, so this keeps working across Prisma client versions/generation
// states.
function isPrismaErrorCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === code;
}

export async function deletePart(id: string, userId: string) {
  let part;
  try {
    part = await prisma.takeoffPart.delete({ where: { id } });
  } catch (err) {
    // NestingPlacement.takeoffPart uses onDelete: Restrict — a part that
    // has ever been placed in a nesting run must not be deletable out from
    // under historical results (see schema comment on NestingPlacement).
    // Surface that as a clear, actionable error instead of a raw FK message.
    if (isPrismaErrorCode(err, "P2003")) {
      throw new Error("This part is used in a nesting job and cannot be deleted.");
    }
    // Record not found (already deleted / bad id) — let the caller map this
    // to a 404 rather than a generic failure.
    if (isPrismaErrorCode(err, "P2025")) {
      throw new Error("NOT_FOUND");
    }
    throw err;
  }
  await logActivity({
    userId,
    action: "DELETE",
    entity: "TAKEOFF_PART",
    entityId: id,
    detail: part.description,
  });
  return part;
}
