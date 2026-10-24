/**
 * Segmentation Phase 6 — approving a plan (pure functions over the parts list).
 *
 * Model (see `SegInfo` in nest-boost/engine.ts):
 *  - the ORIGINAL part stays in the list as role "parent": it keeps its own quantity, size,
 *    thickness and material (so the takeoff still sees ONE original, never the pieces) and
 *    is not nested;
 *  - every segment becomes an ordinary nestable part, role "child", right under its parent,
 *    named `<parent name>-<segment id>` (e.g. "PART-001-S01") with the SAME quantity as the
 *    parent (each original needs one of each piece), thickness and material;
 *  - the plan (cuts + settings) is stored on the parent so the layout can be re-opened.
 *
 * Nothing here touches the nest result; callers decide what to clear (see `removedIds`).
 */
import type { Counters, Group } from "../nest-boost/engine";
import { regionToGroupShape } from "./convert";
import type { Plan, PlanInput } from "./planner";

/** Name of the piece made from segment `segId` of `parentName`, e.g. "PART-001-S01" (also its DXF file name). */
export const pieceName = (parentName: string, segId: string): string => `${parentName}-${segId}`;

export const isSegParent = (g: Pick<Group, "seg">): boolean => g.seg?.role === "parent";
export const isSegChild = (g: Pick<Group, "seg">): boolean => g.seg?.role === "child";

/** Outline signature: lets us notice if the original was changed after it was segmented. */
export const segSignature = (g: Pick<Group, "w" | "h" | "area" | "outer">): string =>
  `${g.w.toFixed(3)}|${g.h.toFixed(3)}|${g.area.toFixed(1)}|${g.outer.length}`;

/** The saved plan of a segmented original, or null (not segmented / nothing usable stored). */
export function savedPlan(g: Pick<Group, "seg">): PlanInput | null {
  const p = g.seg?.role === "parent" ? (g.seg.plan as Partial<PlanInput> | undefined) : undefined;
  return p && Array.isArray(p.stripCuts) && Array.isArray(p.seamCuts) && p.sheet && p.overlap ? (p as PlanInput) : null;
}

export type CommitResult =
  | {
      ok: true;
      groups: Group[];
      parent: Group;
      children: Group[];
      counters: Counters;
      /** Pieces of an earlier segmentation that were replaced (their placements on sheets are no longer valid). */
      removedIds: number[];
    }
  | { ok: false; reason: string };

export interface CommitArgs {
  groups: Group[];
  parentId: number;
  plan: Plan;
  counters: Counters;
  /** Arc tessellation tolerance for the pieces' polygons, mm (same as the fit checks; default 0.1). */
  tol?: number;
}

/**
 * Removes the pieces of a segmentation and makes the parent a normal part again.
 * Returns the removed piece ids so the caller can drop their placements.
 */
export function removeSegmentation(groups: Group[], parentId: number): { groups: Group[]; removedIds: number[] } {
  const parent = groups.find((g) => g.id === parentId);
  if (!parent || !isSegParent(parent)) return { groups, removedIds: [] };
  const gone = new Set(groups.filter((g) => g.seg?.role === "child" && g.seg.parentId === parentId).map((g) => g.id));
  return {
    groups: groups
      .filter((g) => !gone.has(g.id))
      .map((g) => {
        if (g.id !== parentId) return g;
        const copy: Group = { ...g };
        delete copy.seg;
        return copy;
      }),
    removedIds: [...gone],
  };
}

/** Turns an approved plan into pieces. An existing segmentation of the same part is replaced. */
export function commitSegmentation(a: CommitArgs): CommitResult {
  const current = a.groups.find((g) => g.id === a.parentId);
  if (!current) return { ok: false, reason: "The part is no longer in the list." };
  if (isSegChild(current)) return { ok: false, reason: "A piece of a segmented part cannot be segmented again — change the original part." };
  if (!a.plan.valid) {
    const first = a.plan.issues.find((i) => i.severity === "error");
    const n = a.plan.issues.filter((i) => i.severity === "error").length;
    return { ok: false, reason: `The layout still has ${n} error${n === 1 ? "" : "s"}${first ? `: ${first.message}` : ""}` };
  }
  if (!a.plan.segments.length) return { ok: false, reason: "The layout has no segments." };

  const { groups: base, removedIds } = removeSegmentation(a.groups, a.parentId);
  const parent = base.find((g) => g.id === a.parentId)!;
  const qty = Math.max(0, Math.round(Number.isFinite(parent.qty) ? parent.qty : 0));
  const counters: Counters = { id: a.counters.id, sn: a.counters.sn };
  const planId = `P${parent.id}.${counters.id}`;

  const children: Group[] = a.plan.segments.map((s) => {
    const shape = regionToGroupShape(s.cut, a.tol ?? 0.1);
    return {
      id: counters.id++,
      sn: ++counters.sn,
      name: pieceName(parent.name, s.id),
      qty,
      th: parent.th,
      material: parent.material,
      outer: shape.outer,
      holes: shape.holes,
      w: shape.w,
      h: shape.h,
      area: shape.area,
      per: shape.per,
      seg: { role: "child", planId, parentId: parent.id, segId: s.id },
    };
  });

  const marked: Group = {
    ...parent,
    seg: { role: "parent", planId, childIds: children.map((c) => c.id), plan: a.plan.input, sig: segSignature(parent) },
  };
  const groups: Group[] = [];
  for (const g of base) {
    if (g.id === marked.id) groups.push(marked, ...children);
    else groups.push(g);
  }
  return { ok: true, groups, parent: marked, children, counters, removedIds };
}

/** Fields a piece inherits from its original. */
const SHARED = ["qty", "th", "material"] as const;

/**
 * `patch` applied to one part, keeping originals and pieces consistent:
 *  - editing a piece's quantity / thickness / material is ignored (they follow the original);
 *  - editing an original's quantity / thickness / material is applied to its pieces too.
 */
export function patchGroup(groups: Group[], id: number, patch: Partial<Group>): Group[] {
  const target = groups.find((g) => g.id === id);
  if (!target) return groups;
  let own = patch;
  if (isSegChild(target)) {
    own = { ...patch };
    for (const k of SHARED) delete own[k];
    if (!Object.keys(own).length) return groups;
  }
  const shared: Partial<Group> = {};
  if (isSegParent(target)) for (const k of SHARED) if (k in patch) (shared as Record<string, unknown>)[k] = patch[k];
  return groups.map((g) => {
    if (g.id === id) return { ...g, ...own };
    if (isSegParent(target) && g.seg?.role === "child" && g.seg.parentId === id && Object.keys(shared).length) return { ...g, ...shared };
    return g;
  });
}

/**
 * Ids to remove when the user deletes `ids`: an original takes its pieces with it; a piece alone cannot be
 * deleted (undo the segmentation instead) and is reported in `blocked`.
 */
export function expandRemoval(groups: Group[], ids: number[]): { ids: number[]; blocked: number[] } {
  const want = new Set(ids);
  const out = new Set<number>();
  const blocked: number[] = [];
  for (const id of want) {
    const g = groups.find((x) => x.id === id);
    if (!g) continue;
    if (isSegChild(g)) {
      if (want.has(g.seg!.parentId ?? -1)) out.add(id);
      else blocked.push(id);
      continue;
    }
    out.add(id);
    if (isSegParent(g)) for (const c of g.seg!.childIds ?? []) out.add(c);
  }
  return { ids: [...out], blocked };
}

/** The pieces of an original, in segment order. */
export const childrenOf = (groups: Group[], parentId: number): Group[] =>
  groups.filter((g) => g.seg?.role === "child" && g.seg.parentId === parentId);

/** A copy for "Duplicate": never carries segmentation (the copy is a plain part). */
export function withoutSeg(g: Group): Group {
  const copy: Group = { ...g };
  delete copy.seg;
  return copy;
}
