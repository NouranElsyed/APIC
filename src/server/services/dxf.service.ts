import { writeFile, mkdir, unlink } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { parseDxf } from "@/server/calc/dxf";
import { logActivity } from "./activity-log.service";

// Same local-disk pattern as the existing Document upload (public/uploads),
// kept separate under /uploads/dxf so the two never collide.
export async function saveAndParseDxf(takeoffPartId: string, file: File, userId: string) {
  const part = await prisma.takeoffPart.findUnique({ where: { id: takeoffPartId } });
  if (!part) throw new Error("Takeoff part not found");

  const uploadsDir = path.join(process.cwd(), "public", "uploads", "dxf");
  await mkdir(uploadsDir, { recursive: true });
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, safeName), bytes);

  const text = bytes.toString("utf-8");
  const result = parseDxf(text);

  const dxf = await prisma.partDxf.upsert({
    where: { takeoffPartId },
    create: {
      takeoffPartId,
      fileName: file.name,
      filePath: `/uploads/dxf/${safeName}`,
      fileSize: file.size,
      valid: result.valid,
      errorMessage: result.errorMessage,
      unitsDetected: result.unitsDetected,
      areaSqm: result.areaSqm,
      bboxWidthMm: result.bboxWidthMm,
      bboxHeightMm: result.bboxHeightMm,
      outerContourCount: result.outerContourCount,
      holeCount: result.holeCount,
      geometryJson: (result.geometry as Prisma.InputJsonValue | undefined) ?? undefined,
      uploadedById: userId,
    },
    update: {
      fileName: file.name,
      filePath: `/uploads/dxf/${safeName}`,
      fileSize: file.size,
      valid: result.valid,
      errorMessage: result.errorMessage,
      unitsDetected: result.unitsDetected,
      areaSqm: result.areaSqm,
      bboxWidthMm: result.bboxWidthMm,
      bboxHeightMm: result.bboxHeightMm,
      outerContourCount: result.outerContourCount,
      holeCount: result.holeCount,
      geometryJson: (result.geometry as Prisma.InputJsonValue | undefined) ?? undefined,
      uploadedById: userId,
      uploadedAt: new Date(),
    },
  });

  await logActivity({
    userId,
    action: "CREATE",
    entity: "PART_DXF",
    entityId: dxf.id,
    detail: `${file.name} on part ${part.description}${result.valid ? "" : " (invalid)"}`,
  });

  return dxf;
}

export async function deleteDxf(takeoffPartId: string, userId: string) {
  const existing = await prisma.partDxf.findUnique({ where: { takeoffPartId } });
  if (!existing) return null;
  await prisma.partDxf.delete({ where: { takeoffPartId } });
  // Best-effort disk cleanup — don't fail the request if the file's
  // already gone (e.g. re-uploaded, or removed out of band).
  try {
    await unlink(path.join(process.cwd(), "public", existing.filePath.replace(/^\/+/, "")));
  } catch {
    // ignore
  }
  await logActivity({
    userId,
    action: "DELETE",
    entity: "PART_DXF",
    entityId: existing.id,
    detail: existing.fileName,
  });
  return existing;
}
