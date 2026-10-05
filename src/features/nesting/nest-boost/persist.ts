// Serialises / restores the working state of the 2D Nest Boost tool so it can be auto-saved to the database
// (NestingWorkspace, kind "2D"). Items of a nest point at their part by id instead of repeating the whole
// outline, and the (large, rebuildable) per-sheet occupancy grids are never stored.
import type { Counters, Group, Item, OptResult, Settings, Sheet } from "./engine";
import type { NestCfg, SavedNest } from "./saved-nests";

interface EncItem { gid: number; rot: number; x: number; y: number }
type EncSheet = Omit<Sheet, "items" | "grid"> & { items: EncItem[] };
interface EncResult { sheets: EncSheet[]; un: number[]; skip: string[]; manual?: boolean }
interface EncNest extends Omit<SavedNest, "result"> { result: EncResult }

export interface Snapshot2D {
  v: 1;
  cfg: NestCfg;
  units: string;
  groups: Group[];
  /** Every other part referenced by a result (e.g. paired triangles, parts removed from the list since). */
  extra: Group[];
  counters: Counters;
  savedSeq: number;
  importedIds: string[];
  result: EncResult | null;
  resS: Settings | null;
  savedNests: EncNest[];
  activeNestId: number | null;
}

export interface Restored2D {
  cfg: NestCfg;
  units: string;
  groups: Group[];
  counters: Counters;
  savedSeq: number;
  importedIds: string[];
  result: OptResult | null;
  resS: Settings | null;
  savedNests: SavedNest[];
  activeNestId: number | null;
}

function encodeResult(r: OptResult, table: Map<number, Group>): EncResult {
  const reg = (g: Group) => { if (!table.has(g.id)) table.set(g.id, g); return g.id; };
  return {
    sheets: r.sheets.map((sh) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { grid, items, ...rest } = sh;
      return { ...rest, items: items.map((it) => ({ gid: reg(it.g), rot: it.rot, x: it.x, y: it.y })) };
    }),
    un: r.un.map(reg),
    skip: [...r.skip],
    manual: r.manual,
  };
}

function decodeResult(e: EncResult, find: (id: number) => Group | undefined): OptResult {
  return {
    sheets: e.sheets.map((sh): Sheet => ({
      ...sh,
      items: sh.items.flatMap((it): Item[] => {
        const g = find(it.gid);
        return g ? [{ g, rot: it.rot, x: it.x, y: it.y }] : [];
      }),
    })),
    un: e.un.flatMap((id) => { const g = find(id); return g ? [g] : []; }),
    skip: e.skip,
    manual: e.manual,
  };
}

export function encodeSnapshot(s: {
  cfg: NestCfg; units: string; groups: Group[]; counters: Counters; savedSeq: number; importedIds: Iterable<string>;
  result: OptResult | null; resS: Settings | null; savedNests: SavedNest[]; activeNestId: number | null;
}): Snapshot2D {
  const table = new Map<number, Group>();
  const result = s.result ? encodeResult(s.result, table) : null;
  const savedNests = s.savedNests.map((n): EncNest => ({ ...n, result: encodeResult(n.result, table) }));
  const own = new Set(s.groups.map((g) => g.id));
  return {
    v: 1,
    cfg: s.cfg,
    units: s.units,
    groups: s.groups,
    extra: [...table.values()].filter((g) => !own.has(g.id)),
    counters: { id: s.counters.id, sn: s.counters.sn },
    savedSeq: s.savedSeq,
    importedIds: [...s.importedIds],
    result,
    resS: s.resS,
    savedNests,
    activeNestId: s.activeNestId,
  };
}

export function decodeSnapshot(data: unknown): Restored2D | null {
  const s = data as Partial<Snapshot2D> | null;
  if (!s || s.v !== 1 || !Array.isArray(s.groups) || !s.cfg) return null;
  const all = new Map<number, Group>();
  for (const g of s.extra ?? []) all.set(g.id, g);
  for (const g of s.groups) all.set(g.id, g); // the current parts list wins
  const find = (id: number) => all.get(id);
  return {
    cfg: s.cfg,
    units: s.units ?? "1",
    groups: s.groups,
    counters: s.counters ?? { id: Math.max(0, ...s.groups.map((g) => g.id)), sn: Math.max(0, ...s.groups.map((g) => g.sn)) },
    savedSeq: s.savedSeq ?? 0,
    importedIds: s.importedIds ?? [],
    result: s.result ? decodeResult(s.result, find) : null,
    resS: s.resS ?? null,
    savedNests: (s.savedNests ?? []).map((n): SavedNest => {
      const own = new Map(n.groups.map((g) => [g.id, g] as const));
      return { ...n, result: decodeResult(n.result, (id) => own.get(id) ?? all.get(id)) };
    }),
    activeNestId: s.activeNestId ?? null,
  };
}
