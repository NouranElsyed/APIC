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
import { validateSessionForExport, type AssistedSheetSession, type SessionPartCatalogEntry } from "@/server/calc/nesting-assisted-session";
import type { Point } from "@/server/calc/dxf";

// ----------------------------------------------------------------------------
// Phase 2 — orchestration layer between the API route and the pure engine
// in src/server/calc/nesting-engine.ts. This file owns all Prisma I/O for
// nesting runs; the engine itself never touches the database.
//
// Coordinate convention for placements (see schema.prisma for the
// authoritative doc comment): millimeters, sheet origin at bottom-left,
// x right / y up, rotationDeg counter-clockwise (arbitrary degree value as of Phase 2B).
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

// Real outer/hole polygon geometry (already validated, DXF-derived — see
// dxf.ts) for every distinct TakeoffPart placed in this run, keyed by
// takeoffPartId. Used by the frontend sheet preview to render each placed
// part's ACTUAL shape instead of a bounding-box rectangle (PROJECT.md §18 /
// Phase 2B). One lookup per run render, not per placement — a part placed
// 20 times shares a single geometry entry.
export async function getPartGeometryForRun(
  run: NonNullable<Awaited<ReturnType<typeof getNestingRun>>>,
): Promise<Record<string, StoredGeometry>> {
  const partIds = [...new Set(run.sheets.flatMap((s) => s.placements.map((p) => p.takeoffPartId)))];
  if (partIds.length === 0) return {};

  const dxfRows = await prisma.partDxf.findMany({
    where: { takeoffPartId: { in: partIds } },
    select: { takeoffPartId: true, geometryJson: true },
  });

  const out: Record<string, StoredGeometry> = {};
  for (const row of dxfRows) {
    if (isStoredGeometry(row.geometryJson)) {
      out[row.takeoffPartId] = row.geometryJson;
    }
  }
  return out;
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
export interface StoredGeometry {
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

  // Source sheets: `availableQty` is a HARD LIMIT when the user set one
  // (Phase 2B §2) — the engine will never open more physical sheets of
  // that definition than this. Omitted/null availableQty stays unlimited
  // (PROJECT.md §4). See EngineSourceInput / runNestingAlgorithm's
  // sourceRequirements + sourceShortages output for the automatically
  // calculated "how many do I need to buy" / "am I short" answers.
  const sources: EngineSourceInput[] = job.sources.map((s) => ({
    sourceSheetId: s.id,
    material: s.material,
    thicknessMm: s.thicknessMm,
    widthMm: s.widthMm,
    lengthMm: s.lengthMm,
    availableQty: s.availableQty,
  }));

  // Enforce "one current nesting result per project": a re-run REPLACES the
  // previous result rather than appending a new historical run. Deleting
  // old runs cascades to their sheets/placements automatically.
  await prisma.nestingRun.deleteMany({ where: { nestingJobId: jobId } });

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

    // No fake success (Phase 2B §16): only report COMPLETED when every
    // eligible part instance was actually placed. Any shortfall — for any
    // reason, including a hard availableQty cap — is PARTIAL, never a
    // silently-truncated "Nesting Complete".
    const finalStatus = result.totalPartsPlaced === result.totalPartsRequired ? "COMPLETED" : "PARTIAL";

    await prisma.nestingRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        algorithmName: result.algorithmName,
        algorithmVersion: result.algorithmVersion,
        configJson: JSON.parse(JSON.stringify(result.config)),
        partGapMm: result.config.partGapMm,
        marginLeftMm: result.config.marginLeftMm,
        marginRightMm: result.config.marginRightMm,
        marginTopMm: result.config.marginTopMm,
        marginBottomMm: result.config.marginBottomMm,
        totalSheets: result.totalSheetsUsed,
        totalUsedAreaSqm: result.totalUsedAreaSqm,
        totalScrapAreaSqm: result.totalScrapAreaSqm,
        overallUtilizationPercent: result.overallUtilizationPercent,
        totalPartsRequired: result.totalPartsRequired,
        totalPartsPlaced: result.totalPartsPlaced,
        totalPartsUnplaced: result.totalPartsUnplaced,
        unplacedPartsJson: JSON.parse(JSON.stringify(result.unplacedParts)),
        sourceRequirementJson: JSON.parse(JSON.stringify(result.sourceRequirements)),
        sourceShortageJson: JSON.parse(JSON.stringify(result.sourceShortages)),
      },
    });

    await logActivity({
      userId,
      action: "CREATE",
      entity: "NESTING_RUN",
      entityId: run.id,
      detail: `Nesting run ${finalStatus === "COMPLETED" ? "completed" : "partially completed"} for job ${jobId}: ${result.totalPartsPlaced}/${result.totalPartsRequired} placed on ${result.totalSheetsUsed} sheet(s)`,
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

// ----------------------------------------------------------------------------
// Phase 2C — persists an assisted-nesting session (nesting-view.tsx's
// AssistedNestingCanvas) as a real NestingRun, reusing the EXACT same
// NestingRun/NestingSheet/NestingPlacement models and the same
// "replace the job's previous run" convention runNestingForJob already
// uses — no parallel/duplicate nesting system. The only new fields are
// NestingRun.mode ("ASSISTED") and NestingPlacement.origin/isLocked
// (Phase 2C migration), so the existing GET /api/nesting/runs/[runId] and
// DXF export routes work on an assisted result completely unchanged.
// ----------------------------------------------------------------------------

export interface SaveAssistedSessionInput {
  jobId: string;
  userId: string;
  sheets: AssistedSheetSession[];
  partCatalog: Map<string, SessionPartCatalogEntry>;
  config: EngineConfig;
}

export class AssistedSessionValidationError extends NestingRunError {
  constructor(
    message: string,
    public readonly issues: { kind: string; message: string }[],
  ) {
    super(message);
  }
}

export async function saveAssistedNestingRun(input: SaveAssistedSessionInput) {
  const { jobId, userId, sheets, partCatalog, config } = input;

  // Never persist an invalid session (spec: "Never persist overlapping
  // placements / placements outside usable sheet boundaries / quantities
  // exceeding required quantities") — reuse the SAME validator the client
  // already runs before allowing DXF export, so client and server agree.
  const { valid, issues } = validateSessionForExport(sheets, partCatalog, config);
  const blocking = issues.filter((i) => i.kind !== "QUANTITY_SHORTFALL");
  if (!valid || blocking.length > 0) {
    throw new AssistedSessionValidationError("Cannot save an invalid assisted nesting session.", blocking);
  }

  // Reject placements that reference a part not in the catalog (spec
  // "invalid part references") — a defensive check independent of the
  // geometry validator above, since a bad takeoffPartId wouldn't show up
  // as an overlap/margin/quantity issue.
  for (const sheet of sheets) {
    for (const inst of sheet.instances) {
      if (!partCatalog.has(inst.takeoffPartId)) {
        throw new AssistedSessionValidationError(`Placement references an unknown part (${inst.takeoffPartId}).`, [
          { kind: "INVALID_PART", message: `Unknown part reference: ${inst.takeoffPartId}` },
        ]);
      }
    }
  }

  const job = await prisma.nestingJob.findUnique({ where: { id: jobId } });
  if (!job) throw new NestingRunError("Nesting job not found");

  // Same "one current result per job" convention as runNestingForJob.
  await prisma.nestingRun.deleteMany({ where: { nestingJobId: jobId } });

  const run = await prisma.nestingRun.create({
    data: {
      nestingJobId: jobId,
      status: "RUNNING",
      mode: "ASSISTED",
      startedAt: new Date(),
      createdById: userId,
      partGapMm: config.partGapMm,
      marginLeftMm: config.marginLeftMm,
      marginRightMm: config.marginRightMm,
      marginTopMm: config.marginTopMm,
      marginBottomMm: config.marginBottomMm,
      configJson: JSON.parse(JSON.stringify(config)),
      algorithmName: "assisted-nesting-session",
      algorithmVersion: "1.0.0",
    },
  });

  try {
    let sheetNumber = 0;
    for (const sheet of sheets) {
      sheetNumber += 1;
      const sheetAreaSqm = (sheet.widthMm * sheet.lengthMm) / 1_000_000;
      const usedAreaSqm = sheet.instances.reduce((sum, i) => sum + (partCatalog.get(i.takeoffPartId)?.areaSqm ?? 0), 0);
      const dbSheet = await prisma.nestingSheet.create({
        data: {
          nestingRunId: run.id,
          sheetNumber,
          sourceSheetId: sheet.sourceSheetId,
          material: sheet.material,
          thicknessMm: sheet.thicknessMm,
          widthMm: sheet.widthMm,
          lengthMm: sheet.lengthMm,
          usedAreaSqm,
          scrapAreaSqm: Math.max(0, sheetAreaSqm - usedAreaSqm),
          utilizationPercent: sheetAreaSqm > 0 ? (usedAreaSqm / sheetAreaSqm) * 100 : 0,
        },
      });

      const placementRows = sheet.instances.map((inst) => ({
        nestingSheetId: dbSheet.id,
        nestingRunId: run.id,
        takeoffPartId: inst.takeoffPartId,
        instanceNumber: inst.instanceNumber,
        xMm: inst.xMm,
        yMm: inst.yMm,
        rotationDeg: inst.rotationDeg,
        origin: inst.origin,
        isLocked: inst.locked,
      }));
      if (placementRows.length > 0) {
        await prisma.nestingPlacement.createMany({ data: placementRows });
      }
    }

    const totalPartsRequired = [...partCatalog.values()].reduce((sum, p) => sum + p.requiredQty, 0);
    const totalPartsPlaced = sheets.reduce((sum, s) => sum + s.instances.length, 0);
    const totalUsedAreaSqm = sheets.reduce(
      (sum, s) => sum + s.instances.reduce((a, i) => a + (partCatalog.get(i.takeoffPartId)?.areaSqm ?? 0), 0),
      0,
    );
    const totalSheetAreaSqm = sheets.reduce((sum, s) => sum + (s.widthMm * s.lengthMm) / 1_000_000, 0);
    const totalScrapAreaSqm = Math.max(0, totalSheetAreaSqm - totalUsedAreaSqm);

    const finalStatus = totalPartsPlaced >= totalPartsRequired ? "COMPLETED" : "PARTIAL";

    await prisma.nestingRun.update({
      where: { id: run.id },
      data: {
        status: finalStatus,
        completedAt: new Date(),
        totalSheets: sheets.length,
        totalUsedAreaSqm,
        totalScrapAreaSqm,
        overallUtilizationPercent: totalSheetAreaSqm > 0 ? (totalUsedAreaSqm / totalSheetAreaSqm) * 100 : 0,
        totalPartsRequired,
        totalPartsPlaced,
        totalPartsUnplaced: Math.max(0, totalPartsRequired - totalPartsPlaced),
      },
    });

    await logActivity({
      userId,
      action: "CREATE",
      entity: "NESTING_RUN",
      entityId: run.id,
      detail: `Assisted nesting saved for job ${jobId}: ${totalPartsPlaced}/${totalPartsRequired} placed on ${sheets.length} sheet(s)`,
    });

    return getNestingRun(run.id);
  } catch (err) {
    await prisma.nestingRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : "Unknown error saving assisted nesting session",
      },
    });
    await logActivity({
      userId,
      action: "UPDATE",
      entity: "NESTING_RUN",
      entityId: run.id,
      detail: `Assisted nesting save failed for job ${jobId}: ${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  }
}
