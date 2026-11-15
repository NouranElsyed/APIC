// BOQ assemblies (PartGroup): quantity cascade and weight roll-up. Pure functions only (testable without a DB).
//
// Quantities
//   - a root group's `qty` is the number of assemblies of its kind;
//   - a child group's `qty` is the number needed PER parent assembly;
//   - effective qty = qty x the parent's effective qty;
//   - a grouped part's total qty = its group's effective qty x qtyPerAssembly.
//
// Weights
//   TakeoffPart.weightKg is already the TOTAL for the part's total qty, so an assembly's weight is a plain sum of
//   its parts' weights (no multiplication, no way to count a sub-assembly twice). Project totals are summed from
//   the PARTS, never from the groups. Fabricated steel and purchased accessories are kept apart; an accessory
//   without a known weight adds nothing and is counted in `accessoriesWithoutWeight`.

export interface GroupNode { id: string; parentId: string | null; qty: number }

export interface GroupablePart {
  id: string;
  groupId: string | null;
  partType: string;
  qty: number;
  qtyPerAssembly: number;
  weightKg: number;
}

export class BoqGroupError extends Error {}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Effective quantity of every group (qty x all ancestors' qty). Throws on a cycle. */
export function effectiveQtyMap(groups: GroupNode[]): Map<string, number> {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const out = new Map<string, number>();
  const resolve = (id: string, trail: Set<string>): number => {
    const known = out.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) throw new BoqGroupError("Assemblies cannot contain themselves");
    const g = byId.get(id)!;
    trail.add(id);
    const parent = g.parentId && byId.has(g.parentId) ? resolve(g.parentId, trail) : 1;
    trail.delete(id);
    const value = Math.max(0, Math.round(num(g.qty))) * parent;
    out.set(id, value);
    return value;
  };
  for (const g of groups) resolve(g.id, new Set());
  return out;
}

/** True when making `parentId` the parent of `groupId` would close a loop. */
export function wouldCreateCycle(groups: GroupNode[], groupId: string, parentId: string | null): boolean {
  if (!parentId) return false;
  const byId = new Map(groups.map((g) => [g.id, g]));
  let cur: string | null = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === groupId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return false;
}

export const groupedPartQty = (effectiveGroupQty: number, qtyPerAssembly: number) =>
  Math.max(0, Math.round(effectiveGroupQty)) * Math.max(0, Math.round(num(qtyPerAssembly)));

/** Parts whose stored qty no longer matches their group. */
export function planPartQtyUpdates(groups: GroupNode[], parts: GroupablePart[]): { partId: string; qty: number }[] {
  const eff = effectiveQtyMap(groups);
  const updates: { partId: string; qty: number }[] = [];
  for (const p of parts) {
    if (!p.groupId || !eff.has(p.groupId)) continue;
    const qty = groupedPartQty(eff.get(p.groupId)!, p.qtyPerAssembly);
    if (qty !== p.qty) updates.push({ partId: p.id, qty });
  }
  return updates;
}

export interface WeightSplit {
  fabricatedKg: number;
  accessoriesKg: number;
  totalKg: number;
  accessoriesWithoutWeight: number;
}

const emptySplit = (): WeightSplit => ({ fabricatedKg: 0, accessoriesKg: 0, totalKg: 0, accessoriesWithoutWeight: 0 });

function addPart(into: WeightSplit, p: Pick<GroupablePart, "partType" | "weightKg">) {
  const w = num(p.weightKg);
  if (p.partType === "ACCESSORY") {
    into.accessoriesKg += w;
    if (w <= 0) into.accessoriesWithoutWeight += 1;
  } else {
    into.fabricatedKg += w;
  }
  into.totalKg += w;
}

export function splitWeights(parts: Pick<GroupablePart, "partType" | "weightKg">[]): WeightSplit {
  const out = emptySplit();
  for (const p of parts) addPart(out, p);
  return out;
}

export interface GroupRollup {
  effectiveQty: number;
  own: WeightSplit;
  subtree: WeightSplit;
  /** subtree weight of ONE assembly (null when the quantity is 0) */
  perAssembly: WeightSplit | null;
}

export function rollupGroups(groups: GroupNode[], parts: GroupablePart[]): Map<string, GroupRollup> {
  const eff = effectiveQtyMap(groups);
  const own = new Map<string, WeightSplit>(groups.map((g) => [g.id, emptySplit()]));
  for (const p of parts) if (p.groupId && own.has(p.groupId)) addPart(own.get(p.groupId)!, p);

  const children = new Map<string, string[]>();
  for (const g of groups) {
    if (g.parentId && eff.has(g.parentId)) children.set(g.parentId, [...(children.get(g.parentId) ?? []), g.id]);
  }
  const subtreeOf = (id: string): WeightSplit => {
    const t = { ...own.get(id)! };
    for (const c of children.get(id) ?? []) {
      const s = subtreeOf(c);
      t.fabricatedKg += s.fabricatedKg;
      t.accessoriesKg += s.accessoriesKg;
      t.totalKg += s.totalKg;
      t.accessoriesWithoutWeight += s.accessoriesWithoutWeight;
    }
    return t;
  };

  const out = new Map<string, GroupRollup>();
  for (const g of groups) {
    const q = eff.get(g.id)!;
    const sub = subtreeOf(g.id);
    out.set(g.id, {
      effectiveQty: q,
      own: own.get(g.id)!,
      subtree: sub,
      perAssembly: q > 0
        ? { fabricatedKg: sub.fabricatedKg / q, accessoriesKg: sub.accessoriesKg / q, totalKg: sub.totalKg / q, accessoriesWithoutWeight: sub.accessoriesWithoutWeight }
        : null,
    });
  }
  return out;
}
