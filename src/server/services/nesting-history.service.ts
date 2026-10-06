import { prisma } from "@/server/db/client";
import { logActivity } from "./activity-log.service";
import { createAutoNestingProject, type WorkspaceKind } from "./nesting-workspace.service";

/**
 * Per-user nesting history. Every function takes the user id and only ever touches that user's
 * own rows (a row that belongs to somebody else is reported as "not found").
 */

const NAME_MAX = 120;
const cleanName = (name: unknown): string => (typeof name === "string" ? name.trim().slice(0, NAME_MAX) : "");

const pad = (n: number) => String(n).padStart(2, "0");
export function defaultHistoryName(stamp?: string, hint?: string): string {
  const d = new Date();
  const when = (stamp && stamp.trim().slice(0, 40)) || `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const h = hint?.trim().slice(0, 60);
  return h ? `${h} — ${when}` : `Import — ${when}`;
}

export async function listHistory(userId: string) {
  return prisma.nestingHistory.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, savedProjectId: true, createdAt: true, updatedAt: true },
  });
}

export async function createHistory(userId: string, name?: string, stamp?: string, hint?: string) {
  return prisma.nestingHistory.create({
    data: { userId, name: cleanName(name) || defaultHistoryName(stamp, hint) },
    select: { id: true, name: true, savedProjectId: true, createdAt: true, updatedAt: true },
  });
}

export async function renameHistory(userId: string, id: string, name: string) {
  const clean = cleanName(name);
  if (!clean) return null;
  const { count } = await prisma.nestingHistory.updateMany({ where: { id, userId }, data: { name: clean } });
  return count ? { id, name: clean } : null;
}

export async function deleteHistory(userId: string, id: string) {
  const { count } = await prisma.nestingHistory.deleteMany({ where: { id, userId } });
  return count > 0;
}

export async function getHistoryData(userId: string, id: string, kind: WorkspaceKind) {
  const row = await prisma.nestingHistory.findFirst({
    where: { id, userId },
    select: { data2D: true, data1D: true, updatedAt: true },
  });
  if (!row) return undefined; // not found
  return { data: kind === "2D" ? row.data2D : row.data1D, updatedAt: row.updatedAt };
}

/** Returns false when the entry does not exist / is not the user's. */
export async function saveHistoryData(userId: string, id: string, kind: WorkspaceKind, data: unknown) {
  const { count } = await prisma.nestingHistory.updateMany({
    where: { id, userId },
    data: kind === "2D" ? { data2D: data as object } : { data1D: data as object },
  });
  return count > 0;
}

/**
 * "Save as project": creates a real project with the name the user typed and copies the whole
 * working state (2D + 1D) of the history entry into it. The history entry stays (marked with the
 * project it became), so it keeps working as a snapshot.
 */
export async function saveHistoryAsProject(userId: string, userName: string, id: string, name: string, stamp?: string) {
  const clean = cleanName(name);
  if (!clean) return null;
  const entry = await prisma.nestingHistory.findFirst({ where: { id, userId }, select: { id: true, data2D: true, data1D: true } });
  if (!entry) return null;

  const project = await createAutoNestingProject(userId, userName, stamp, clean);
  const copies: { kind: WorkspaceKind; data: object }[] = [];
  if (entry.data2D != null) copies.push({ kind: "2D", data: entry.data2D as object });
  if (entry.data1D != null) copies.push({ kind: "1D", data: entry.data1D as object });
  for (const c of copies) {
    await prisma.nestingWorkspace.upsert({
      where: { projectId_kind: { projectId: project.id, kind: c.kind } },
      update: { dataJson: c.data, updatedById: userId },
      create: { projectId: project.id, kind: c.kind, dataJson: c.data, updatedById: userId },
    });
  }
  await prisma.nestingHistory.updateMany({ where: { id, userId }, data: { savedProjectId: project.id } });
  await logActivity({ userId, action: "CREATE", entity: "PROJECT", entityId: project.id, detail: `${project.number} (saved from nesting history)` });
  return project;
}
