import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { applyQuantityChanges } from "@/server/calc/nest-sync";

export type WorkspaceKind = "2D" | "1D";

const pad = (n: number) => String(n).padStart(2, "0");

/** Placeholder client used by every auto-created nesting project (Project.customerId is mandatory). */
async function getOrCreateUnassignedCustomer() {
  return prisma.customer.upsert({
    where: { code: "UNASSIGNED" },
    update: {},
    create: { code: "UNASSIGNED", name: "Unassigned (auto-created nests)" },
  });
}

/**
 * Creates an (empty) project for the nesting tabs. The client is the placeholder "Unassigned"
 * customer — Project.customerId is mandatory — and the user can change it later.
 *
 * `name` is what the user typed; without one the project is called "<user> — <date time>"
 * (`stamp` = the date/time as the USER sees it, sent by the browser).
 */
export async function createAutoNestingProject(userId: string, userName: string, stamp?: string, name?: string) {
  const customer = await getOrCreateUnassignedCustomer();
  const now = new Date();
  const label = (stamp && stamp.trim().slice(0, 40)) || `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const projectName = name?.trim() ? name.trim().slice(0, 120) : `${userName} — ${label}`;
  const base = `NEST-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

  // Project.number is unique: retry with a random suffix on the (very unlikely) clash.
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    try {
      const project = await prisma.project.create({
        data: {
          number,
          name: projectName,
          description: "Created from the Nesting tabs. Set the client when ready.",
          customerId: customer.id,
          stage: "TENDERING",
          status: "UNDER_STUDY",
          createdById: userId,
        },
        select: { id: true, number: true, name: true },
      });
      await logActivity({ userId, action: "CREATE", entity: "PROJECT", entityId: project.id, detail: `${project.number} (nesting)` });
      return project;
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== "P2002" || attempt === 4) throw err;
    }
  }
  throw new Error("Could not create the project");
}

export async function getWorkspace(projectId: string, kind: WorkspaceKind) {
  return prisma.nestingWorkspace.findUnique({
    where: { projectId_kind: { projectId, kind } },
    select: { dataJson: true, updatedAt: true, version: true },
  });
}

export async function getWorkspaceVersion(projectId: string, kind: WorkspaceKind): Promise<number | null> {
  const ws = await prisma.nestingWorkspace.findUnique({ where: { projectId_kind: { projectId, kind } }, select: { version: true } });
  return ws?.version ?? null;
}

export type SaveResult = { ok: true; updatedAt: Date; version: number } | { ok: false; version: number };

/**
 * Saves a project workspace. With `baseVersion` (the version the caller last read) the save is refused when the
 * workspace has moved on since — e.g. the BOQ changed a quantity while this tab was open — instead of silently
 * overwriting it. Without `baseVersion` (older clients) it behaves as before. Every successful save bumps the version.
 */
export async function saveWorkspace(projectId: string, kind: WorkspaceKind, data: unknown, userId: string, baseVersion?: number): Promise<SaveResult> {
  if (baseVersion !== undefined) {
    const hit = await prisma.nestingWorkspace.updateMany({
      where: { projectId, kind, version: baseVersion },
      data: { dataJson: data as object, updatedById: userId, version: { increment: 1 } },
    });
    if (hit.count === 1) {
      const ws = await prisma.nestingWorkspace.findUnique({ where: { projectId_kind: { projectId, kind } }, select: { updatedAt: true, version: true } });
      return { ok: true, updatedAt: ws!.updatedAt, version: ws!.version };
    }
    const current = await getWorkspaceVersion(projectId, kind);
    if (current !== null) return { ok: false, version: current }; // exists but moved on
    // no row yet: fall through and create it
  }
  const ws = await prisma.nestingWorkspace.upsert({
    where: { projectId_kind: { projectId, kind } },
    update: { dataJson: data as object, updatedById: userId, version: { increment: 1 } },
    create: { projectId, kind, dataJson: data as object, updatedById: userId },
    select: { updatedAt: true, version: true },
  });
  return { ok: true, updatedAt: ws.updatedAt, version: ws.version };
}

/**
 * Writes quantities into the project's 2D nest (BOQ -> nest). The write is conditional on the version that was read,
 * so it can never overwrite a browser save that landed in between; on a race it re-reads and tries again.
 * Returns the nest part ids that were changed.
 */
export async function pushQuantitiesToNest(projectId: string, changes: { nestPartId: number; qty: number }[], userId: string): Promise<number[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ws = await prisma.nestingWorkspace.findUnique({ where: { projectId_kind: { projectId, kind: "2D" } }, select: { dataJson: true, version: true } });
    if (!ws) return [];
    const { data, applied } = applyQuantityChanges(ws.dataJson, changes);
    if (applied.length === 0) return [];
    const hit = await prisma.nestingWorkspace.updateMany({
      where: { projectId, kind: "2D", version: ws.version },
      data: { dataJson: data as object, updatedById: userId, version: { increment: 1 } },
    });
    if (hit.count === 1) return applied;
  }
  throw new Error("The nest was being saved at the same time — try again");
}
