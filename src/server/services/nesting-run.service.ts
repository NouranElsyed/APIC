import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { getEligibleNestingParts } from "./nesting.service";
import {
  runNestingAlgorithm,
  DEFAULT_ENGINE_CONFIG,
  type EnginePartInput,
  type EngineSourceInput,
  type EngineConfig,
  type NestingAlgorithmResult,
} from "@/server/calc/nesting-engine";
import type { Point } from "@/server/calc/dxf";

// ----------------------------------------------------------------------------
// Phase 2 — orchestration layer between the API route and the pure engine
// in src/server/calc/nesting-engine.ts. This file owns all Prisma I/O for
// nesting runs; the engine itself never touches the database.
//
// Coordinate convention for placements (see schema.prisma for the
// authoritative doc comment): millimeters, sheet origin at bottom-left,
// x right / y up, rotationDeg counter-clockwise (0/90/180/270 only for now).
// ----------------------------------------------------------------------------

const runInclude = {
  sheets: {
    orderBy: { sheetNumber: "asc" as const },
    include: { placements: true },
  },
};

export async function listNestingRuns(nestingJobId: string) {
  return prisma.nestingRun.findMany({
    where: { nestingJobId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getNestingRun(id: string) {
  return prisma.nestingRun.findUnique({
    where: { id },
    include: runInclude,
  });
}

export async function deleteNestingRun(id: string, userId: string) {
  const run = await prisma.nestingRun.delete({ where: { id } });
  await logActivity({
    userId,
    action: "DELETE",
    entity: "NESTING_RUN",
    entityId: id,
    detail: `Nesting run deleted (was ${run.status})`,
  });
  return run;
}

// Shape of PartDxf.geometryJson as written by dxf.service.ts / dxf.ts.
interface StoredGeometry {
  outer: Point[];
  holes: Point[][];
}

function isStoredGeometry(value: unknown): value is StoredGeometry {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as StoredGeometry).outer) &&
    (value as StoredGeometry).outer.length >= 3
  );
}

export class NestingRunError extends Error {}

// Runs the real nesting engine for a job and persists a full NestingRun +
// NestingSheet + NestingPlacement tree. Mirrors getNestingJob's data source
// (getEligibleNestingParts + job.sources) so "what gets nested" always
// matches what the UI already shows as "Parts to Nest" / "Source Coverage" —
// never a separately-selected list.
export async function runNestingForJob(
  jobId: string,
  userId: string,
  config: EngineConfig = DEFAULT_ENGINE_CONFIG,
): Promise<{ run: Awaited<ReturnType<typeof getNestingRun>>; result: NestingAlgorithmResult }> {
  const job = await prisma.nestingJob.findUnique({
    where: { id: jobId },
    include: { sources: { orderBy: { createdAt: "asc" } } },
  });
  if (!job) throw new NestingRunError("Nesting job not found");

  const eligible = await getEligibleNestingParts(job.projectId);
  if (eligible.included.length === 0) {
    throw new NestingRunError("No eligible parts to nest — every part is missing a DXF, material, or thickness.");
  }

  const dxfRows = await prisma.partDxf.findMany({
    where: { takeoffPartId: { in: eligible.included.map((p) => p.id) } },
    select: { takeoffPartId: true, geometryJson: true },
  });
  const geometryByPartId = new Map(dxfRows.map((r) => [r.takeoffPartId, r.geometryJson]));

  const parts: EnginePartInput[] = [];
  for (const p of eligible.included) {
    const geo = geometryByPartId.get(p.id);
    if (!isStoredGeometry(geo)) {
      // Should not happen (getEligibleNestingParts already excludes parts
      // without usable geometry), but never silently drop a part — surface
      // it as a hard failure instead of nesting with wrong/missing shape data.
      throw new NestingRunError(`Part #${p.itemNo} (${p.description}) has no usable outer geometry.`);
    }
    parts.push({
      takeoffPartId: p.id,
      itemNo: p.itemNo,
      material: p.material,
      thicknessMm: p.thicknessMm,
      qty: p.qty,
      areaSqm: p.dxfAreaSqm ?? 0,
      outer: geo.outer,
    });
  }

  const sources: EngineSourceInput[] = job.sources.map((s) => ({
    sourceSheetId: s.id,
    material: s.material,
    thicknessMm: s.thicknessMm,
    widthMm: s.widthMm,
    lengthMm: s.lengthMm,
    availableQty: s.availableQty,
  }));

  const run = await prisma.nestingRun.create({
    data: {
      nestingJobId: jobId,
      status: "RUNNING",
      startedAt: new Date(),
      createdById: userId,
    },
  });

  try {
    const result = runNestingAlgorithm(parts, sources, config);

    // Persist sheets sequentially (typically a handful per run) so each
    // placement batch below can reference the real database sheet id;
    // placements themselves are bulk-inserted with createMany.
    const dbSheetIdByEngineSheetNumber = new Map<number, string>();
    for (const group of result.groups) {
      for (const sheet of group.sheets) {
        const dbSheet = await prisma.nestingSheet.create({
          data: {
            nestingRunId: run.id,
            sheetNumber: sheet.sheetNumber,
            sourceSheetId: sheet.sourceSheetId,
            material: sheet.material,
            thicknessMm: sheet.thicknessMm,
            widthMm: sheet.widthMm,
            lengthMm: sheet.lengthMm,
            usedAreaSqm: sheet.usedAreaSqm,
            scrapAreaSqm: sheet.scrapAreaSqm,
            utilizationPercent: sheet.utilizationPercent,
          },
        });
        dbSheetIdByEngineSheetNumber.set(sheet.sheetNumber, dbSheet.id);
      }
    }

    const placementRows = result.groups.flatMap((group) =>
      group.sheets.flatMap((sheet) =>
        sheet.placements.map((p) => ({
          nestingSheetId: dbSheetIdByEngineSheetNumber.get(sheet.sheetNumber)!,
          nestingRunId: run.id,
          takeoffPartId: p.takeoffPartId,
          instanceNumber: p.instanceNumber,
          xMm: p.xMm,
          yMm: p.yMm,
          rotationDeg: p.rotationDeg,
        })),
      ),
    );
    if (placementRows.length > 0) {
      await prisma.nestingPlacement.createMany({ data: placementRows });
    }

    await prisma.nestingRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        algorithmName: result.algorithmName,
        algorithmVersion: result.algorithmVersion,
        configJson: result.config,
        totalSheets: result.totalSheetsUsed,
        totalUsedAreaSqm: result.totalUsedAreaSqm,
        totalScrapAreaSqm: result.totalScrapAreaSqm,
        overallUtilizationPercent: result.overallUtilizationPercent,
        totalPartsRequired: result.totalPartsRequired,
        totalPartsPlaced: result.totalPartsPlaced,
        totalPartsUnplaced: result.totalPartsUnplaced,
        unplacedPartsJson: result.unplacedParts,
      },
    });

    await logActivity({
      userId,
      action: "CREATE",
      entity: "NESTING_RUN",
      entityId: run.id,
      detail: `Nesting run completed for job ${jobId}: ${result.totalPartsPlaced}/${result.totalPartsRequired} placed on ${result.totalSheetsUsed} sheet(s)`,
    });

    return { run: await getNestingRun(run.id), result };
  } catch (err) {
    // Never leave a run stuck in RUNNING — mark it FAILED with whatever
    // error info we have, then rethrow so the API returns a real error.
    // Previously COMPLETED runs are never touched by this path.
    await prisma.nestingRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : "Unknown nesting engine error",
      },
    });
    await logActivity({
      userId,
      action: "UPDATE",
      entity: "NESTING_RUN",
      entityId: run.id,
      detail: `Nesting run failed for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  }
}
