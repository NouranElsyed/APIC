import { prisma } from "@/server/db/client";
import { parseDxf } from "@/server/calc/dxf";
import { buildPartFromDxf, importableParts, sizeOfPart, type ImportRowConfig } from "@/server/calc/dxf-import";
import { partToDxf } from "@/server/calc/dxf-labels";
import { takeoffPartSchema } from "@/server/validators/takeoff";
import { createPart } from "./takeoff.service";
import { saveAndParseDxf } from "./dxf.service";

export interface DxfImportItem extends ImportRowConfig {
  /** Index in the deterministic part list of the file (see importableParts). */
  partIndex: number;
}
export interface DxfImportResult { partIndex: number; ok: boolean; error?: string }

// One DXF file -> one takeoff part per selected contour (+ each part's own DXF).
// A file with several contours (a sheet with labelled parts) is split: every
// part is stored as its own single-part DXF, so nesting/download keep working.
// The client sends one file per request, so a big batch never hits the request
// size limit and the UI can show progress.
export async function importDxfParts(
  drawingId: string, file: File, items: DxfImportItem[], userId: string,
): Promise<DxfImportResult[]> {
  const drawing = await prisma.takeoffDrawing.findUnique({ where: { id: drawingId } });
  if (!drawing) throw new Error("Drawing not found");

  // Re-parse on the server: never trust geometry numbers coming from the browser.
  const parsed = parseDxf(await file.text());
  const list = importableParts(parsed);
  if (list.length === 0) {
    const error = parsed.errorMessage ?? "No closed geometry found";
    return items.map((i) => ({ partIndex: i.partIndex, ok: false, error }));
  }
  const base = file.name.replace(/\.dxf$/i, "");

  const results: DxfImportResult[] = [];
  for (const item of items) {
    try {
      const part = list[item.partIndex];
      if (!part) throw new Error("Part not found in file");
      const built = buildPartFromDxf(sizeOfPart(part), { ...item, partType: "PLATE" });
      if (!built.ok) throw new Error(built.error);

      const last = await prisma.takeoffPart.aggregate({ where: { drawingId }, _max: { itemNo: true } });
      const itemNo = (last._max.itemNo ?? 0) + 1;
      const validated = takeoffPartSchema.safeParse({ ...built.input, drawingId, itemNo });
      if (!validated.success) throw new Error("Invalid part data");

      // Single-part file: keep the original (exact arcs). Multi-part: cut this part out.
      const stored = list.length === 1
        ? file
        : new File([partToDxf(part)], `${base}_${item.partIndex + 1}.dxf`, { type: "application/dxf" });

      const created = await createPart(validated.data, userId);
      try {
        await saveAndParseDxf(created.id, stored, userId);
      } catch (err) {
        // Don't leave a DXF-less half-import behind.
        await prisma.takeoffPart.delete({ where: { id: created.id } }).catch(() => undefined);
        throw err;
      }
      results.push({ partIndex: item.partIndex, ok: true });
    } catch (err) {
      results.push({ partIndex: item.partIndex, ok: false, error: err instanceof Error ? err.message : "Import failed" });
    }
  }
  return results;
}
