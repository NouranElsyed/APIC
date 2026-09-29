import { prisma } from "@/server/db/client";
import { parseDxf } from "@/server/calc/dxf";
import { buildPartFromDxf, type ImportRowConfig } from "@/server/calc/dxf-import";
import { takeoffPartSchema } from "@/server/validators/takeoff";
import { createPart } from "./takeoff.service";
import { saveAndParseDxf } from "./dxf.service";

// One DXF file -> one takeoff part (+ its stored DXF). The client calls this
// once per file so a big batch never hits the request-size limit and the UI
// can show progress. Item numbers continue from the drawing's current max.
export async function importDxfAsPart(drawingId: string, file: File, cfg: ImportRowConfig, userId: string) {
  const drawing = await prisma.takeoffDrawing.findUnique({ where: { id: drawingId } });
  if (!drawing) throw new Error("Drawing not found");

  // Re-parse on the server: never trust geometry numbers coming from the browser.
  const parsed = parseDxf(await file.text());
  const built = buildPartFromDxf(parsed, cfg);
  if (!built.ok) throw new Error(built.error);

  const last = await prisma.takeoffPart.aggregate({ where: { drawingId }, _max: { itemNo: true } });
  const itemNo = (last._max.itemNo ?? 0) + 1;

  const validated = takeoffPartSchema.safeParse({ ...built.input, drawingId, itemNo });
  if (!validated.success) throw new Error("Invalid part data");

  const part = await createPart(validated.data, userId);
  try {
    await saveAndParseDxf(part.id, file, userId);
  } catch (err) {
    // Don't leave a DXF-less half-import behind.
    await prisma.takeoffPart.delete({ where: { id: part.id } }).catch(() => undefined);
    throw err;
  }
  return part;
}
