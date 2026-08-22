// DXF export for a completed Nesting Run (PROJECT.md §25-§33). Pure
// orchestration: loads the already-persisted run/sheets/placements plus
// each part's original DXF geometry, and hands everything to the DXF
// generator (nesting-dxf-writer.ts) — no new nesting coordinates are ever
// computed here (PROJECT.md §28).
//
//   Nesting Run -> DXF Export Service (this file) -> DXF Generator
//
// kept deliberately separate from nesting-run.service.ts (which owns
// *running* the engine) per the architecture split in PROJECT.md §35.

import { prisma } from "@/server/db/client";
import type { Point } from "@/server/calc/dxf";
import { writeNestingSheetDxf, nestingSheetDxfFileName, type DxfSheetInput } from "@/server/calc/nesting-dxf-writer";
import { buildZip } from "@/server/calc/zip";

interface StoredGeometry {
  outer: Point[];
  holes: Point[][];
}

function isStoredGeometry(value: unknown): value is StoredGeometry {
  return !!value && typeof value === "object" && Array.isArray((value as StoredGeometry).outer);
}

export class NestingDxfExportError extends Error {}

async function loadSheetInputs(runId: string): Promise<DxfSheetInput[]> {
  const run = await prisma.nestingRun.findUnique({
    where: { id: runId },
    include: {
      sheets: {
        orderBy: { sheetNumber: "asc" },
        include: { placements: { orderBy: [{ takeoffPartId: "asc" }, { instanceNumber: "asc" }] } },
      },
    },
  });
  if (!run) throw new NestingDxfExportError("Nesting run not found");
  if (run.sheets.length === 0) throw new NestingDxfExportError("This run has no sheets to export yet.");

  const partIds = [...new Set(run.sheets.flatMap((s) => s.placements.map((p) => p.takeoffPartId)))];
  const partRows = await prisma.takeoffPart.findMany({
    where: { id: { in: partIds } },
    select: { id: true, itemNo: true, dxf: { select: { geometryJson: true } } },
  });
  const partById = new Map(partRows.map((p) => [p.id, p]));

  // Same margin values the run was actually executed with (PROJECT.md
  // §13/§27) — falls back to 0 only for pre-margin-field historical runs.
  const marginLeftMm = run.marginLeftMm ?? 0;
  const marginRightMm = run.marginRightMm ?? 0;
  const marginTopMm = run.marginTopMm ?? 0;
  const marginBottomMm = run.marginBottomMm ?? 0;

  return run.sheets.map((sheet) => ({
    runId: run.id,
    sheetNumber: sheet.sheetNumber,
    widthMm: sheet.widthMm,
    lengthMm: sheet.lengthMm,
    marginLeftMm,
    marginRightMm,
    marginTopMm,
    marginBottomMm,
    placements: sheet.placements.map((placement) => {
      const part = partById.get(placement.takeoffPartId);
      const geo = part?.dxf?.geometryJson;
      if (!part || !isStoredGeometry(geo)) {
        throw new NestingDxfExportError(
          `Part ${placement.takeoffPartId} no longer has usable DXF geometry — cannot export this run.`,
        );
      }
      return {
        takeoffPartId: placement.takeoffPartId,
        itemNo: part.itemNo,
        instanceNumber: placement.instanceNumber,
        xMm: placement.xMm,
        yMm: placement.yMm,
        rotationDeg: placement.rotationDeg,
        outer: geo.outer,
        holes: geo.holes,
      };
    }),
  }));
}

// Returns a single sheet's DXF as text.
export async function exportNestingSheetDxf(runId: string, sheetNumber: number): Promise<{ fileName: string; content: string }> {
  const sheets = await loadSheetInputs(runId);
  const sheet = sheets.find((s) => s.sheetNumber === sheetNumber);
  if (!sheet) throw new NestingDxfExportError(`Sheet #${sheetNumber} not found on this run.`);
  return { fileName: nestingSheetDxfFileName(runId, sheetNumber), content: writeNestingSheetDxf(sheet) };
}

// Returns every sheet's DXF, packaged as a ZIP if there is more than one
// (PROJECT.md §31), or the single DXF's own content otherwise.
export async function exportNestingRunDxf(
  runId: string,
): Promise<{ fileName: string; content: Buffer; contentType: string }> {
  const sheets = await loadSheetInputs(runId);

  if (sheets.length === 1) {
    const dxfText = writeNestingSheetDxf(sheets[0]);
    return {
      fileName: nestingSheetDxfFileName(runId, sheets[0].sheetNumber),
      content: Buffer.from(dxfText, "utf-8"),
      contentType: "application/dxf",
    };
  }

  const zip = buildZip(
    sheets.map((sheet) => ({
      name: nestingSheetDxfFileName(runId, sheet.sheetNumber),
      content: Buffer.from(writeNestingSheetDxf(sheet), "utf-8"),
    })),
  );

  return {
    fileName: `Nesting_Run_${runId}_DXF.zip`,
    content: zip,
    contentType: "application/zip",
  };
}
