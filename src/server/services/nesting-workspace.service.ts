import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";

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
 * Creates the project used when somebody imports a DXF / CSV in the Nesting tabs
 * without having opened a project first. Named "<user> — <date time>" so everyone
 * can find their own work; the user can later rename it and set the real client.
 *
 * `stamp` is the date/time as the USER sees it (their local clock), sent by the browser.
 */
export async function createAutoNestingProject(userId: string, userName: string, stamp?: string) {
  const customer = await getOrCreateUnassignedCustomer();
  const now = new Date();
  const label = (stamp && stamp.trim().slice(0, 40)) || `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())} ${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const base = `NEST-${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

  // Project.number is unique: retry with a random suffix on the (very unlikely) clash.
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    try {
      const project = await prisma.project.create({
        data: {
          number,
          name: `${userName} — ${label}`,
          description: "Auto-created from a DXF / CSV import in the Nesting tab. Rename it and set the client when ready.",
          customerId: customer.id,
          stage: "TENDERING",
          status: "UNDER_STUDY",
          createdById: userId,
        },
        select: { id: true, number: true, name: true },
      });
      await logActivity({ userId, action: "CREATE", entity: "PROJECT", entityId: project.id, detail: `${project.number} (auto, nesting import)` });
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
    select: { dataJson: true, updatedAt: true },
  });
}

export async function saveWorkspace(projectId: string, kind: WorkspaceKind, data: unknown, userId: string) {
  return prisma.nestingWorkspace.upsert({
    where: { projectId_kind: { projectId, kind } },
    update: { dataJson: data as object, updatedById: userId },
    create: { projectId, kind, dataJson: data as object, updatedById: userId },
    select: { updatedAt: true },
  });
}
