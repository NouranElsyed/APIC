import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
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
