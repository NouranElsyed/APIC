import { prisma } from "@/server/db/client";
import type { NestingJobInput, NestingSourceInput } from "@/server/validators/nesting";
import { logActivity } from "./activity-log.service";

// ----------------------------------------------------------------------------
// Automatic eligible-part collection (replaces the old manual "Add to
// Nesting" selection). A part is eligible when it has a valid, parsed DXF
// with real geometry and a quantity greater than zero. Everything else is
// reported back as "excluded" with a human-readable reason so nothing is
// ever silently dropped from the list.
//
// NOTE on grouping: TakeoffPart has no `material` field in the existing
// Standard Calculations data model, and this feature intentionally does
// NOT modify that model. Groups are therefore keyed on thickness only —
// the one geometry-relevant property every plate/cone/pipe part already
// carries. Source sheets still capture `material` (it's useful metadata
// once a real nesting/material-matching engine exists), but Phase 1b
// coverage checking matches on thickness. This is a deliberate, documented
// limitation, not an oversight.
// ----------------------------------------------------------------------------

export type ExcludedReason =
  | "DXF missing"
  | "DXF invalid"
  | "Invalid geometry"
  | "Quantity is 0";

export interface EligiblePart {
  id: string;
  itemNo: number;
  description: string;
  partType: string;
  thicknessMm: number | null;
  qty: number;
  dxfAreaSqm: number | null;
  bboxWidthMm: number | null;
  bboxHeightMm: number | null;
  drawing: { id: string; drawingNumber: string; title: string };
}

export interface ExcludedPart {
  id: string;
  itemNo: number;
  description: string;
  qty: number;
  reason: ExcludedReason;
  detail: string | null;
  drawing: { id: string; drawingNumber: string; title: string };
}

export interface NestingGroup {
  key: string; // e.g. "10" — thicknessMm as a stable string key
  thicknessMm: number;
  partCount: number;
  totalPcs: number;
  parts: EligiblePart[];
}

export interface EligibleNestingParts {
  included: EligiblePart[];
  excluded: ExcludedPart[];
  groups: NestingGroup[];
  totalParts: number;
  totalPcs: number;
}

export async function getEligibleNestingParts(projectId: string): Promise<EligibleNestingParts> {
  const parts = await prisma.takeoffPart.findMany({
    where: { drawing: { projectId } },
    include: { dxf: true, drawing: { select: { id: true, drawingNumber: true, title: true } } },
    orderBy: [{ drawing: { drawingNumber: "asc" } }, { itemNo: "asc" }],
  });

  const included: EligiblePart[] = [];
  const excluded: ExcludedPart[] = [];

  for (const part of parts) {
    if (part.qty <= 0) {
      excluded.push({
        id: part.id,
        itemNo: part.itemNo,
        description: part.description,
        qty: part.qty,
        reason: "Quantity is 0",
        detail: null,
        drawing: part.drawing,
      });
      continue;
    }
    if (!part.dxf) {
      excluded.push({
        id: part.id,
        itemNo: part.itemNo,
        description: part.description,
        qty: part.qty,
        reason: "DXF missing",
        detail: null,
        drawing: part.drawing,
      });
      continue;
    }
    if (!part.dxf.valid) {
      excluded.push({
        id: part.id,
        itemNo: part.itemNo,
        description: part.description,
        qty: part.qty,
        reason: "DXF invalid",
        detail: part.dxf.errorMessage,
        drawing: part.drawing,
      });
      continue;
    }
    if (!part.dxf.geometryJson) {
      excluded.push({
        id: part.id,
        itemNo: part.itemNo,
        description: part.description,
        qty: part.qty,
        reason: "Invalid geometry",
        detail: "DXF was marked valid but no usable geometry was stored.",
        drawing: part.drawing,
      });
      continue;
    }

    included.push({
      id: part.id,
      itemNo: part.itemNo,
      description: part.description,
      partType: part.partType,
      thicknessMm: part.thicknessMm,
      qty: part.qty,
      dxfAreaSqm: part.dxf.areaSqm,
      bboxWidthMm: part.dxf.bboxWidthMm,
      bboxHeightMm: part.dxf.bboxHeightMm,
      drawing: part.drawing,
    });
  }

  const groupMap = new Map<string, NestingGroup>();
  for (const part of included) {
    const key = part.thicknessMm != null ? String(part.thicknessMm) : "unspecified";
    let group = groupMap.get(key);
    if (!group) {
      group = { key, thicknessMm: part.thicknessMm ?? 0, partCount: 0, totalPcs: 0, parts: [] };
      groupMap.set(key, group);
    }
    group.partCount += 1;
    group.totalPcs += part.qty;
    group.parts.push(part);
  }
  const groups = Array.from(groupMap.values()).sort((a, b) => a.thicknessMm - b.thicknessMm);

  return {
    included,
    excluded,
    groups,
    totalParts: included.length,
    totalPcs: included.reduce((s, p) => s + p.qty, 0),
  };
}

// ----------------------------------------------------------------------------
// Source coverage — for every thickness group required by the project's
// eligible parts, is there at least one declared source sheet of that
// thickness? Phase 1b only checks compatibility exists; it does not yet
// verify available sheet count is enough to cut every part (that's for the
// real nesting/optimization engine).
// ----------------------------------------------------------------------------

export interface GroupCoverage {
  key: string;
  thicknessMm: number;
  totalPcs: number;
  covered: boolean;
}

export function computeSourceCoverage(
  groups: NestingGroup[],
  sources: { thicknessMm: number }[],
): GroupCoverage[] {
  const sourceThicknesses = new Set(sources.map((s) => s.thicknessMm));
  return groups.map((g) => ({
    key: g.key,
    thicknessMm: g.thicknessMm,
    totalPcs: g.totalPcs,
    covered: sourceThicknesses.has(g.thicknessMm),
  }));
}

// ----------------------------------------------------------------------------
// Nesting Jobs — now just a named container per Project, holding the
// user-declared source sheets. Included/excluded parts are computed live
// from the Project, never stored per-job, so a job can never silently go
// stale or miss a part someone forgot to add.
// ----------------------------------------------------------------------------

const jobInclude = {
  sources: { orderBy: { createdAt: "asc" as const } },
};

export async function listNestingJobs(projectId: string) {
  const [jobs, eligible] = await Promise.all([
    prisma.nestingJob.findMany({
      where: { projectId },
      include: jobInclude,
      orderBy: { createdAt: "desc" },
    }),
    getEligibleNestingParts(projectId),
  ]);

  return jobs.map((job) => ({
    ...job,
    partsSummary: {
      totalParts: eligible.totalParts,
      totalPcs: eligible.totalPcs,
      excludedCount: eligible.excluded.length,
      groupCount: eligible.groups.length,
    },
  }));
}

export async function getNestingJob(id: string) {
  const job = await prisma.nestingJob.findUnique({ where: { id }, include: jobInclude });
  if (!job) return null;
  const eligible = await getEligibleNestingParts(job.projectId);
  const coverage = computeSourceCoverage(eligible.groups, job.sources);
  return { ...job, eligible, coverage };
}

export async function createNestingJob(data: NestingJobInput, userId: string) {
  const job = await prisma.nestingJob.create({
    data: {
      projectId: data.projectId,
      name: data.name,
      material: data.material ?? null,
      thicknessMm: data.thicknessMm ?? null,
      createdById: userId,
    },
    include: jobInclude,
  });
  await logActivity({ userId, action: "CREATE", entity: "NESTING_JOB", entityId: job.id, detail: job.name });
  return job;
}

export async function deleteNestingJob(id: string, userId: string) {
  const job = await prisma.nestingJob.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "NESTING_JOB", entityId: id, detail: job.name });
  return job;
}

// ----------------------------------------------------------------------------
// Source Material — the one genuinely manual input left in this workflow.
// ----------------------------------------------------------------------------

export async function addNestingSource(jobId: string, data: NestingSourceInput, userId: string) {
  const source = await prisma.nestingSource.create({
    data: {
      nestingJobId: jobId,
      material: data.material,
      thicknessMm: data.thicknessMm,
      widthMm: data.widthMm,
      lengthMm: data.lengthMm,
      availableQty: data.availableQty,
    },
  });
  await logActivity({
    userId,
    action: "CREATE",
    entity: "NESTING_SOURCE",
    entityId: source.id,
    detail: `${data.material} ${data.thicknessMm}mm ${data.widthMm}×${data.lengthMm} on job ${jobId}`,
  });
  return source;
}

export async function removeNestingSource(jobId: string, sourceId: string, userId: string) {
  const source = await prisma.nestingSource.delete({ where: { id: sourceId } });
  await logActivity({
    userId,
    action: "DELETE",
    entity: "NESTING_SOURCE",
    entityId: sourceId,
    detail: `removed from job ${jobId}`,
  });
  return source;
}
