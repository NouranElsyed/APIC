import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";

// ----------------------------------------------------------------------------
// Phase 2A — persistence foundation only. No nesting algorithm lives here.
// These functions exist so a future engine (Phase 2B+) has somewhere to
// write its results; nothing in the current app calls createNestingRun()
// yet. "Run Nesting" in the UI still shows the existing placeholder.
//
// Coordinate convention for placements (see schema.prisma for the
// authoritative doc comment): millimeters, sheet origin at bottom-left,
// x right / y up, rotationDeg counter-clockwise.
// ----------------------------------------------------------------------------

const runInclude = {
  sheets: {
    orderBy: { sheetNumber: "asc" as const },
    include: {
      placements: true,
    },
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

export async function createNestingRun(nestingJobId: string, userId: string) {
  const run = await prisma.nestingRun.create({
    data: {
      nestingJobId,
      status: "PENDING",
      createdById: userId,
    },
  });
  await logActivity({
    userId,
    action: "CREATE",
    entity: "NESTING_RUN",
    entityId: run.id,
    detail: `Nesting run created for job ${nestingJobId}`,
  });
  return run;
}

export async function updateNestingRunStatus(
  id: string,
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED",
  extra?: { startedAt?: Date; completedAt?: Date; errorMessage?: string | null },
) {
  return prisma.nestingRun.update({
    where: { id },
    data: {
      status,
      ...(extra?.startedAt ? { startedAt: extra.startedAt } : {}),
      ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
      ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
    },
  });
}

// Snapshot the source sheet's current material/thickness/dimensions onto a
// new NestingSheet row — deliberately copied, not referenced live, so this
// sheet's metadata never changes if the NestingSource is edited later.
export async function createNestingSheet(params: {
  nestingRunId: string;
  sheetNumber: number;
  sourceSheetId?: string | null;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
}) {
  return prisma.nestingSheet.create({
    data: {
      nestingRunId: params.nestingRunId,
      sheetNumber: params.sheetNumber,
      sourceSheetId: params.sourceSheetId ?? null,
      material: params.material,
      thicknessMm: params.thicknessMm,
      widthMm: params.widthMm,
      lengthMm: params.lengthMm,
    },
  });
}

// nestingRunId is required alongside nestingSheetId (denormalized — see
// schema.prisma NestingPlacement doc comment) so instanceNumber uniqueness
// is enforced per (run, part) rather than per (sheet, part).
export async function createNestingPlacement(params: {
  nestingSheetId: string;
  nestingRunId: string;
  takeoffPartId: string;
  instanceNumber: number;
  xMm: number;
  yMm: number;
  rotationDeg?: number;
}) {
  return prisma.nestingPlacement.create({
    data: {
      nestingSheetId: params.nestingSheetId,
      nestingRunId: params.nestingRunId,
      takeoffPartId: params.takeoffPartId,
      instanceNumber: params.instanceNumber,
      xMm: params.xMm,
      yMm: params.yMm,
      rotationDeg: params.rotationDeg ?? 0,
    },
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
