// Two-way link between the project's 2D nest and the BOQ (Part List). Pure functions only.
//
// Each linked takeoff part remembers `syncedQty`: the quantity both sides had at the last sync. Comparing it with
// the nest's current quantity and the BOQ's current quantity tells WHO changed:
//
//   nest == boq                         -> linked (nothing to move)
//   only the nest differs from synced   -> nest_changed : the nest value is applied to the BOQ
//   only the BOQ differs from synced    -> boq_changed  : the BOQ value has to be pushed into the nest
//   both differ from synced (and from each other), or there is no synced value -> conflict : a person decides
//   the nest part no longer exists      -> orphan       : never deleted automatically
//
// A part that sits in an assembly has a DERIVED quantity (group qty x qtyPerAssembly). If the nest changes its
// quantity, qtyPerAssembly is recomputed by division; when the result is not a whole number that is a conflict
// instead of a rounded guess.
//
// Shape (outline, holes, thickness, material) is owned by the nest, grade / paint / group by the BOQ: thickness and
// material differences are REPORTED, never overwritten, because they change weight and nesting groups.

export interface NestPartLite { id: number; qty: number; th: number; material: string }

export interface LinkedPartLite {
  id: string;
  nestPartId: number;
  qty: number;
  thicknessMm: number | null;
  material: string | null;
  syncedQty: number | null;
  groupId: string | null;
  /** effective quantity of the part's assembly (null when the part is not in one) */
  groupQty: number | null;
}

export type SyncStatus = "linked" | "nest_changed" | "boq_changed" | "conflict" | "orphan";

export interface SyncItem {
  partId: string;
  nestPartId: number;
  status: SyncStatus;
  boqQty: number;
  nestQty: number | null;
  /** nest_changed only: what the BOQ part becomes */
  newQty?: number;
  newQtyPerAssembly?: number;
  reason?: string;
  /** thickness / material that differ (reported only) */
  differences: string[];
}

export interface SyncPlan {
  items: SyncItem[];
  /** nest parts that no takeoff part is linked to yet */
  unlinkedNestIds: number[];
}

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();

export function reconcileNestParts(nest: NestPartLite[], linked: LinkedPartLite[]): SyncPlan {
  const byId = new Map(nest.map((n) => [n.id, n]));
  const linkedIds = new Set(linked.map((l) => l.nestPartId));
  const items: SyncItem[] = [];

  for (const l of linked) {
    const n = byId.get(l.nestPartId);
    if (!n) {
      items.push({ partId: l.id, nestPartId: l.nestPartId, status: "orphan", boqQty: l.qty, nestQty: null, reason: "No longer in the nest (removed, or its quantity is 0)", differences: [] });
      continue;
    }
    const differences: string[] = [];
    if (n.th > 0 && l.thicknessMm != null && l.thicknessMm !== n.th) differences.push(`thickness: nest ${n.th} mm, BOQ ${l.thicknessMm} mm`);
    if (n.material.trim() && l.material && !same(n.material, l.material)) differences.push(`material: nest ${n.material}, BOQ ${l.material}`);

    const base = { partId: l.id, nestPartId: l.nestPartId, boqQty: l.qty, nestQty: n.qty, differences };
    if (n.qty === l.qty) { items.push({ ...base, status: "linked" }); continue; }

    const nestMoved = l.syncedQty !== null && n.qty !== l.syncedQty;
    const boqMoved = l.syncedQty !== null && l.qty !== l.syncedQty;
    if (l.syncedQty === null) {
      items.push({ ...base, status: "conflict", reason: "Quantities differ and there is no earlier sync to tell which side changed" });
    } else if (nestMoved && boqMoved) {
      items.push({ ...base, status: "conflict", reason: `Both changed since the last sync (was ${l.syncedQty}): nest ${n.qty}, BOQ ${l.qty}` });
    } else if (boqMoved) {
      items.push({ ...base, status: "boq_changed", reason: `BOQ changed ${l.syncedQty} → ${l.qty}; the nest still has ${n.qty}` });
    } else if (l.groupId && l.groupQty !== null) {
      if (l.groupQty > 0 && n.qty % l.groupQty === 0) {
        items.push({ ...base, status: "nest_changed", newQty: n.qty, newQtyPerAssembly: n.qty / l.groupQty });
      } else {
        items.push({ ...base, status: "conflict", reason: `Nest quantity ${n.qty} is not a whole multiple of the assembly quantity ${l.groupQty}` });
      }
    } else {
      items.push({ ...base, status: "nest_changed", newQty: n.qty });
    }
  }

  return { items, unlinkedNestIds: nest.filter((n) => !linkedIds.has(n.id)).map((n) => n.id) };
}

export function summarizePlan(plan: SyncPlan): Record<SyncStatus, number> & { unlinked: number } {
  const out = { linked: 0, nest_changed: 0, boq_changed: 0, conflict: 0, orphan: 0, unlinked: plan.unlinkedNestIds.length };
  for (const i of plan.items) out[i.status] += 1;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Writing BOQ quantities into the nest snapshot (the `data` of /api/nesting/workspace). Same effect as typing the
// quantity into the part list of the nest tool: only `groups[].qty` changes; placements and results are left as they
// are (the tool treats them as out of date until it is run again). Paired-triangle copies (`cid`) and pieces of a
// segmented part are not parts of their own and are never touched.

export function applyQuantityChanges(data: unknown, changes: { nestPartId: number; qty: number }[]): { data: unknown; applied: number[] } {
  const groups = (data as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups) || changes.length === 0) return { data, applied: [] };
  const want = new Map(changes.map((c) => [c.nestPartId, Math.max(0, Math.round(c.qty))]));
  const applied: number[] = [];
  const next = (groups as Record<string, unknown>[]).map((g) => {
    if (!g || typeof g !== "object" || g.cid != null || (g.seg as { role?: unknown } | null | undefined)?.role === "child") return g;
    const id = g.id;
    if (typeof id !== "number" || !want.has(id)) return g;
    applied.push(id);
    return { ...g, qty: want.get(id) };
  });
  return { data: { ...(data as object), groups: next }, applied };
}
