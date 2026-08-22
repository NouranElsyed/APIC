import { prisma } from "@/server/db/client";
import type { NestingJobInput, NestingSourceInput } from "@/server/validators/nesting";
import { logActivity } from "./activity-log.service";

// ----------------------------------------------------------------------------
// Automatic eligible-part collection (replaces the old manual "Add to
// Nesting" selection). A part is eligible when it has a valid, parsed DXF
// with real geometry, a quantity greater than zero, AND a resolvable
// material + thickness. Everything else is reported back as "excluded" with
// a human-readable reason so nothing is ever silently dropped from the list.
//
// Material and thickness are resolved PER PART from TakeoffPart.material /
// TakeoffPart.thicknessMm — the existing Standard Calculations data model —
// never from NestingJob.material / NestingJob.thicknessMm. A project's parts
// can span multiple materials/thicknesses, so Nesting Groups and Source
// Coverage are always computed per (material, thickness) pair. See the
// NestingJob doc comment in schema.prisma for why the legacy job-level
// fields are never read here.
// ----------------------------------------------------------------------------

export type ExcludedReason =
  | "DXF missing"
  | "DXF invalid"
  | "Invalid geometry"
  | "Quantity is 0"
  | "Missing material"
  | "Missing thickness";

export interface EligiblePart {
  id: string;
  itemNo: number;
  description: string;
  partType: string;
  material: string;
  thicknessMm: number;
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
  key: string; // stable "material||thicknessMm" key
  material: string;
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

    // Material and thickness are resolved PER PART, straight from the
    // Standard Calculations / TakeoffPart record — never from the
    // NestingJob. A part missing either is excluded (not silently
    // defaulted) until the user fixes it in Standard Calculations.
    const material = part.material?.trim() || null;
    if (!material) {
      excluded.push({
        id: part.id,
        itemNo: part.itemNo,
        description: part.description,
        qty: part.qty,
        reason: "Missing material",
        detail: "Set a material for this part in Standard Calculations.",
        drawing: part.drawing,
      });
      continue;
    }
    if (part.thicknessMm == null || part.thicknessMm <= 0) {
      excluded.push({
        id: part.id,
        itemNo: part.itemNo,
        description: part.description,
        qty: part.qty,
        reason: "Missing thickness",
        detail: "Set a thickness for this part in Standard Calculations.",
        drawing: part.drawing,
      });
      continue;
    }

    included.push({
      id: part.id,
      itemNo: part.itemNo,
      description: part.description,
      partType: part.partType,
      material,
      thicknessMm: part.thicknessMm,
      qty: part.qty,
      dxfAreaSqm: part.dxf.areaSqm,
      bboxWidthMm: part.dxf.bboxWidthMm,
      bboxHeightMm: part.dxf.bboxHeightMm,
      drawing: part.drawing,
    });
  }

  // Group by (material, thickness) — the minimum grouping key. A project
  // with multiple materials/thicknesses produces multiple groups; parts are
  // never merged just because the NestingJob has a single legacy value.
  const groupMap = new Map<string, NestingGroup>();
  for (const part of included) {
    const key = `${part.material}||${part.thicknessMm}`;
    let group = groupMap.get(key);
    if (!group) {
      group = { key, material: part.material, thicknessMm: part.thicknessMm, partCount: 0, totalPcs: 0, parts: [] };
      groupMap.set(key, group);
    }
    group.partCount += 1;
    group.totalPcs += part.qty;
    group.parts.push(part);
  }
  const groups = Array.from(groupMap.values()).sort(
    (a, b) => a.material.localeCompare(b.material) || a.thicknessMm - b.thicknessMm,
  );

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
  material: string;
  thicknessMm: number;
  totalPcs: number;
  covered: boolean;
}

export function computeSourceCoverage(
  groups: NestingGroup[],
  sources: { material: string; thicknessMm: number }[],
): GroupCoverage[] {
  // Compatibility is material + thickness, matched per group — never
  // NestingJob.material / NestingJob.thicknessMm.
  const sourceKeys = new Set(sources.map((s) => `${s.material}||${s.thicknessMm}`));
  return groups.map((g) => ({
    key: g.key,
    material: g.material,
    thicknessMm: g.thicknessMm,
    totalPcs: g.totalPcs,
    covered: sourceKeys.has(`${g.material}||${g.thicknessMm}`),
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
  // Lightweight run history (no sheets/placements — see nesting-run.service's
  // getNestingRun for the full tree of a single run) so the job detail view
  // can show past runs and their headline numbers without a second request.
  runs: { orderBy: { createdAt: "desc" as const } },
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
      availableQty: data.availableQty ?? null,
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
