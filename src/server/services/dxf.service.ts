import { put, del } from "@vercel/blob";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { parseDxf } from "@/server/calc/dxf";
import { logActivity } from "./activity-log.service";

// The parser returns a strongly-typed { outer, holes } shape (see
// src/server/calc/dxf.ts). Prisma's Json input type wants a plain,
// structurally-untyped JSON value, so round-tripping through
// JSON.stringify/parse is the safest way to hand it a value TypeScript
// will accept — no `as` casting games, and it also guarantees the value
// really is JSON-serializable before it ever reaches the database.
function toJsonInput(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

// Files are stored in Vercel Blob, not on local disk. Vercel's serverless
// functions run from a read-only bundle (only /tmp is writable, and /tmp
// itself doesn't persist between invocations or across instances), so
// writing to `public/uploads` — which works in local dev — throws
// ENOENT/EROFS in production. Blob gives us a real persistent file store
// with a public URL back immediately, no extra infra to manage.
export async function saveAndParseDxf(takeoffPartId: string, file: File, userId: string) {
  const part = await prisma.takeoffPart.findUnique({ where: { id: takeoffPartId } });
  if (!part) throw new Error("Takeoff part not found");

  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const blob = await put(`dxf/${safeName}`, bytes, {
    access: "public",
    contentType: "application/dxf",
  });

  const text = bytes.toString("utf-8");
  const result = parseDxf(text);

  // If this part already had a DXF, drop the old blob so uploads don't
  // pile up forever in storage — best effort, never blocks the save.
  const previous = await prisma.partDxf.findUnique({ where: { takeoffPartId } });
  if (previous?.filePath) {
    try {
      await del(previous.filePath);
    } catch {
      // ignore — old blob may already be gone
    }
  }

  const dxf = await prisma.partDxf.upsert({
    where: { takeoffPartId },
    create: {
      takeoffPartId,
      fileName: file.name,
      filePath: blob.url,
      fileSize: file.size,
      valid: result.valid,
      errorMessage: result.errorMessage,
      unitsDetected: result.unitsDetected,
      areaSqm: result.areaSqm,
      bboxWidthMm: result.bboxWidthMm,
      bboxHeightMm: result.bboxHeightMm,
      outerContourCount: result.outerContourCount,
      holeCount: result.holeCount,
      geometryJson: toJsonInput(result.geometry),
      uploadedById: userId,
    },
    update: {
      fileName: file.name,
      filePath: blob.url,
      fileSize: file.size,
      valid: result.valid,
      errorMessage: result.errorMessage,
      unitsDetected: result.unitsDetected,
      areaSqm: result.areaSqm,
      bboxWidthMm: result.bboxWidthMm,
      bboxHeightMm: result.bboxHeightMm,
      outerContourCount: result.outerContourCount,
      holeCount: result.holeCount,
      geometryJson: toJsonInput(result.geometry),
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
  // Best-effort cleanup — don't fail the request if the blob's already
  // gone (e.g. re-uploaded, or removed out of band).
  try {
    await del(existing.filePath);
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
