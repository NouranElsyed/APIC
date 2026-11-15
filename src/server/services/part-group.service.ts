// BOQ assemblies: create / edit groups, move parts in and out, keep every grouped part's quantity (and therefore its
// weight) in step with its group, and report weights split into fabricated steel and purchased accessories.
// The rules themselves (quantity cascade, roll-up) are pure and live in src/server/calc/boq-groups.ts.

import { ensureNestInSync } from "./nest-sync-guard";
import { prisma } from "@/server/db/client";
import { buildDefaultAreaFormula, computeTakeoffPart, type PartType } from "@/server/calc/takeoff";
import {
  BoqGroupError, effectiveQtyMap, groupedPartQty, planPartQtyUpdates, rollupGroups, splitWeights, wouldCreateCycle,
  type GroupNode, type WeightSplit,
} from "@/server/calc/boq-groups";
import type { AssignPartsInput, PartGroupInput } from "@/server/validators/part-group";
import { logActivity } from "./activity-log.service";

export class PartGroupError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";

const loadNodes = (projectId: string): Promise<GroupNode[]> =>
  prisma.partGroup.findMany({ where: { projectId }, select: { id: true, parentId: true, qty: true } });

/** Re-runs the area/weight/paint/scrap maths for a stored part at a new quantity (same rules as takeoff.service). */
export function recomputeFor(p: { partType: PartType; geometry: unknown; thicknessMm: number | null; paintSides: number; areaFormula: string | null; buyWeightKg: number | null }, qty: number) {
  const geometry = (p.geometry ?? {}) as Record<string, unknown>;
  const { formulaError: _e, unitArea: _u, ...computed } = computeTakeoffPart({
    partType: p.partType, geometry, qty, thicknessMm: p.thicknessMm, paintSides: p.paintSides,
    areaFormula: p.areaFormula || buildDefaultAreaFormula(p.partType, geometry), buyWeightKg: p.buyWeightKg,
  });
  return computed;
}

/** Total quantity a part must have inside `groupId`; `fallbackQty` for an ungrouped part. */
export async function resolvePartQty(projectId: string, groupId: string | null | undefined, qtyPerAssembly: number, fallbackQty: number): Promise<number> {
  if (!groupId) return fallbackQty;
  const nodes = await loadNodes(projectId);
  if (!nodes.some((g) => g.id === groupId)) throw new PartGroupError("That assembly does not belong to this project", 409);
  return groupedPartQty(effectiveQtyMap(nodes).get(groupId)!, qtyPerAssembly);
}

/** Brings every grouped part of the project back in line with its group's quantity. Returns how many changed. */
export async function recalcGroupedParts(projectId: string): Promise<number> {
  const [nodes, parts] = await Promise.all([
    loadNodes(projectId),
    prisma.takeoffPart.findMany({
      where: { drawing: { projectId }, groupId: { not: null } },
      select: { id: true, groupId: true, partType: true, qty: true, qtyPerAssembly: true, weightKg: true, geometry: true, thicknessMm: true, paintSides: true, areaFormula: true, buyWeightKg: true },
    }),
  ]);
  const updates = planPartQtyUpdates(nodes, parts);
  if (!updates.length) return 0;
  const byId = new Map(parts.map((p) => [p.id, p]));
  await prisma.$transaction(
    updates.map((u) => {
      const p = byId.get(u.partId)!;
      return prisma.takeoffPart.update({ where: { id: u.partId }, data: { qty: u.qty, ...recomputeFor(p, u.qty) } });
    }),
  );
  return updates.length;
}

// ------------------------------------------------------------------------------------------------ reading

export interface GroupRowDTO {
  id: string; code: string; name: string; dwgNo: string | null; qty: number; remark: string | null;
  parentId: string | null; sortOrder: number; effectiveQty: number; partCount: number;
  own: WeightSplit; subtree: WeightSplit; perAssembly: WeightSplit | null;
}
export interface BoqData {
  groups: GroupRowDTO[];
  ungrouped: { partCount: number; weight: WeightSplit };
  /** summed from the parts, never from the groups, so a sub-assembly is never counted twice */
  project: WeightSplit;
}

export async function getBoq(projectId: string): Promise<BoqData> {
  await ensureNestInSync(projectId);
  const [groups, parts] = await Promise.all([
    prisma.partGroup.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    prisma.takeoffPart.findMany({ where: { drawing: { projectId } }, select: { id: true, groupId: true, partType: true, qty: true, qtyPerAssembly: true, weightKg: true } }),
  ]);
  const roll = rollupGroups(groups, parts);
  const counts = new Map<string, number>();
  for (const p of parts) if (p.groupId) counts.set(p.groupId, (counts.get(p.groupId) ?? 0) + 1);
  const loose = parts.filter((p) => !p.groupId || !roll.has(p.groupId));
  return {
    groups: groups.map((g) => ({
      id: g.id, code: g.code, name: g.name, dwgNo: g.dwgNo, qty: g.qty, remark: g.remark, parentId: g.parentId, sortOrder: g.sortOrder,
      effectiveQty: roll.get(g.id)!.effectiveQty, partCount: counts.get(g.id) ?? 0,
      own: roll.get(g.id)!.own, subtree: roll.get(g.id)!.subtree, perAssembly: roll.get(g.id)!.perAssembly,
    })),
    ungrouped: { partCount: loose.length, weight: splitWeights(loose) },
    project: splitWeights(parts),
  };
}

// ------------------------------------------------------------------------------------------------ writing groups

async function checkParent(projectId: string, groupId: string | null, parentId: string | null | undefined) {
  if (!parentId) return;
  const nodes = await loadNodes(projectId);
  if (!nodes.some((g) => g.id === parentId)) throw new PartGroupError("The parent assembly does not belong to this project", 409);
  if (groupId && wouldCreateCycle(nodes, groupId, parentId)) throw new PartGroupError("An assembly cannot be placed inside itself or inside one of its own sub-assemblies", 409);
}

export async function createGroup(data: PartGroupInput, userId: string) {
  const project = await prisma.project.findUnique({ where: { id: data.projectId }, select: { id: true } });
  if (!project) throw new PartGroupError("Project not found", 404);
  await checkParent(data.projectId, null, data.parentId);
  const count = await prisma.partGroup.count({ where: { projectId: data.projectId } });
  try {
    const group = await prisma.partGroup.create({
      data: { projectId: data.projectId, code: data.code, name: data.name, dwgNo: data.dwgNo ?? null, qty: data.qty, remark: data.remark ?? null, parentId: data.parentId ?? null, sortOrder: count },
    });
    await logActivity({ userId, action: "CREATE", entity: "PART_GROUP", entityId: group.id, detail: `${group.code} — ${group.name}` });
    return group;
  } catch (e) {
    if (isUnique(e)) throw new PartGroupError(`An assembly with code ${data.code} already exists in this project`, 409);
    throw e;
  }
}

export async function updateGroup(id: string, data: PartGroupInput, userId: string) {
  const existing = await prisma.partGroup.findUnique({ where: { id }, select: { id: true, projectId: true } });
  if (!existing) throw new PartGroupError("Assembly not found", 404);
  if (existing.projectId !== data.projectId) throw new PartGroupError("An assembly cannot be moved to another project", 409);
  await checkParent(existing.projectId, id, data.parentId);
  try {
    const group = await prisma.partGroup.update({
      where: { id },
      data: { code: data.code, name: data.name, dwgNo: data.dwgNo ?? null, qty: data.qty, remark: data.remark ?? null, parentId: data.parentId ?? null },
    });
    const changed = await recalcGroupedParts(existing.projectId);
    if (changed) await (await import("./nest-sync.service")).autoSyncAfterBoqChange(existing.projectId, userId); // lazy: nest-sync imports this file
    await logActivity({ userId, action: "UPDATE", entity: "PART_GROUP", entityId: id, detail: `${group.code} — qty ${group.qty}${changed ? `, ${changed} part quantities updated` : ""}` });
    return { group, partsUpdated: changed };
  } catch (e) {
    if (isUnique(e)) throw new PartGroupError(`An assembly with code ${data.code} already exists in this project`, 409);
    throw e;
  }
}

/** Deleting takes the parts out of the assembly but keeps their quantities. Blocked while sub-assemblies exist. */
export async function deleteGroup(id: string, userId: string) {
  const g = await prisma.partGroup.findUnique({ where: { id }, include: { _count: { select: { children: true } } } });
  if (!g) throw new PartGroupError("Assembly not found", 404);
  if (g._count.children > 0) throw new PartGroupError("This assembly still has sub-assemblies. Move or delete them first.", 409);
  await prisma.partGroup.delete({ where: { id } });
  await logActivity({ userId, action: "DELETE", entity: "PART_GROUP", entityId: id, detail: `${g.code} — ${g.name}` });
}

// ------------------------------------------------------------------------------------------------ moving parts

export interface AssignResult {
  assigned: number;
  quantityChanged: { partId: string; from: number; to: number }[];
}

export async function assignParts(data: AssignPartsInput, userId: string): Promise<AssignResult> {
  const parts = await prisma.takeoffPart.findMany({
    where: { id: { in: data.partIds }, drawing: { projectId: data.projectId } },
    select: { id: true, qty: true, qtyPerAssembly: true, partType: true, geometry: true, thicknessMm: true, paintSides: true, areaFormula: true, buyWeightKg: true },
  });
  if (parts.length !== new Set(data.partIds).size) throw new PartGroupError("Some of the selected parts do not belong to this project", 409);

  if (!data.groupId) {
    await prisma.takeoffPart.updateMany({ where: { id: { in: parts.map((p) => p.id) } }, data: { groupId: null } });
    await logActivity({ userId, action: "UPDATE", entity: "PART_GROUP", entityId: data.projectId, detail: `${parts.length} parts taken out of their assembly` });
    return { assigned: parts.length, quantityChanged: [] };
  }

  const nodes = await loadNodes(data.projectId);
  if (!nodes.some((g) => g.id === data.groupId)) throw new PartGroupError("That assembly does not belong to this project", 409);
  const eff = effectiveQtyMap(nodes).get(data.groupId)!;

  const quantityChanged: AssignResult["quantityChanged"] = [];
  const writes = parts.map((p) => {
    // No per-assembly qty given: keep the current quantity when it divides evenly, otherwise 1.
    const perAssembly = data.qtyPerAssembly ?? (eff > 0 && p.qty > 0 && p.qty % eff === 0 ? p.qty / eff : 1);
    const qty = groupedPartQty(eff, perAssembly);
    if (qty !== p.qty) quantityChanged.push({ partId: p.id, from: p.qty, to: qty });
    return prisma.takeoffPart.update({
      where: { id: p.id },
      data: { groupId: data.groupId, qtyPerAssembly: perAssembly, qty, ...(qty !== p.qty ? recomputeFor(p, qty) : {}) },
    });
  });
  await prisma.$transaction(writes);
  await logActivity({ userId, action: "UPDATE", entity: "PART_GROUP", entityId: data.groupId, detail: `${parts.length} parts added${quantityChanged.length ? `, ${quantityChanged.length} quantities adjusted` : ""}` });
  return { assigned: parts.length, quantityChanged };
}

export { BoqGroupError };
