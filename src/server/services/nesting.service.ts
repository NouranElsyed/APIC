import { prisma } from "@/server/db/client";
import type { NestingJobInput, NestingJobItemInput } from "@/server/validators/nesting";
import { logActivity } from "./activity-log.service";

const itemInclude = {
  items: {
    include: {
      takeoffPart: { include: { dxf: true, drawing: true } },
    },
    orderBy: { createdAt: "asc" as const },
  },
};

export async function listNestingJobs(projectId: string) {
  return prisma.nestingJob.findMany({
    where: { projectId },
    include: itemInclude,
    orderBy: { createdAt: "desc" },
  });
}

export async function getNestingJob(id: string) {
  return prisma.nestingJob.findUnique({ where: { id }, include: itemInclude });
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
    include: itemInclude,
  });
  await logActivity({ userId, action: "CREATE", entity: "NESTING_JOB", entityId: job.id, detail: job.name });
  return job;
}

export async function deleteNestingJob(id: string, userId: string) {
  const job = await prisma.nestingJob.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "NESTING_JOB", entityId: id, detail: job.name });
  return job;
}

// Only DXF-validated parts are nestable in Phase 1 — enforced here (not
// just in the UI) so the API can't be used to sneak in geometry-less parts.
export async function addNestingJobItem(jobId: string, data: NestingJobItemInput, userId: string) {
  const part = await prisma.takeoffPart.findUnique({ where: { id: data.takeoffPartId }, include: { dxf: true } });
  if (!part) throw new Error("Takeoff part not found");
  if (!part.dxf || !part.dxf.valid) {
    throw new Error("This part has no valid DXF attached and cannot be added to a nesting job yet");
  }
  const item = await prisma.nestingJobItem.create({
    data: {
      nestingJobId: jobId,
      takeoffPartId: data.takeoffPartId,
      qtyOverride: data.qtyOverride ?? null,
    },
  });
  await logActivity({ userId, action: "CREATE", entity: "NESTING_JOB_ITEM", entityId: item.id, detail: part.description });
  return item;
}

export async function removeNestingJobItem(jobId: string, itemId: string, userId: string) {
  const item = await prisma.nestingJobItem.delete({ where: { id: itemId } });
  await logActivity({ userId, action: "DELETE", entity: "NESTING_JOB_ITEM", entityId: itemId, detail: `removed from job ${jobId}` });
  return item;
}
