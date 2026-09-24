import { INSTALL_LABEL } from "./steel-pricing-data";
import type { InstallKey, ProfileRates, RateBook } from "./types";
import { PROFILES } from "./types";

/** Rate groups that can carry a chosen option. "install.<key>" addresses one installation activity. */
type GroupId = "handling" | "scrap" | "accessories" | "inflation" | "cutting" | "rolling" | "welding" | "painting" | "paintingArea" | "ndt" | "fabIndirect" | "subcontract";

/** The rate group behind a component (painting switches to the per-m² group when priced by area). */
export function rateGroup(R: RateBook, groupId: string): ProfileRates | null {
  if (groupId.startsWith("install.")) return R.install[groupId.slice(8) as InstallKey] ?? null;
  return (R as unknown as Record<string, ProfileRates | undefined>)[groupId as GroupId] ?? null;
}

const PERCENT_GROUPS = new Set(["handling", "scrap", "accessories", "inflation", "ndt", "fabIndirect"]);
/** Percent-like groups are stored as fractions (0.07) and shown as 7 %. */
export const isPercentGroup = (groupId: string) => PERCENT_GROUPS.has(groupId);

export const COMPONENT_LABEL: Record<string, string> = {
  handling: "Handling", scrap: "Scrap", accessories: "Accessories", inflation: "Inflation", cutting: "Cutting", rolling: "Rolling",
  welding: "Fit-up & welding", painting: "Painting", ndt: "NDT", fabIndirect: "Fabrication indirect", subcontract: "Subcontractor",
};
export const componentLabel = (id: string) => id.startsWith("install.") ? INSTALL_LABEL[id.slice(8) as InstallKey] ?? id : COMPONENT_LABEL[id] ?? id;

export interface RateOption { id: string; label: string; value: number; custom: boolean }

export const optionName = (R: RateBook, p: string) => (PROFILES as string[]).includes(p) ? `Profile ${p}` : R.rateLabels[p] ?? "Custom price";

/** Options for one group: the built-in profiles that have a value, then the user's own prices. */
export function optionsOf(R: RateBook, groupId: string): RateOption[] {
  const g = rateGroup(R, groupId);
  if (!g) return [];
  const builtin = PROFILES.filter((p) => g[p] !== undefined).map((p) => ({ id: p as string, label: `Profile ${p}`, value: g[p] as number, custom: false }));
  const custom = Object.keys(g).filter((k) => !(PROFILES as string[]).includes(k) && g[k] !== undefined)
    .map((k) => ({ id: k, label: R.rateLabels[k] ?? "Custom price", value: g[k] as number, custom: true }));
  return [...builtin, ...custom];
}

export const newOptionId = () => `x${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Pure updaters for RateBook (used with the view's onRates). */
export function addOption(R: RateBook, groupId: string, id: string, label: string, value: number): RateBook {
  const n = structuredClone(R);
  const g = rateGroup(n, groupId);
  if (g) { g[id] = value; n.rateLabels[id] = label; }
  return n;
}
export function setOptionValue(R: RateBook, groupId: string, id: string, value: number): RateBook {
  const n = structuredClone(R);
  const g = rateGroup(n, groupId);
  if (g) g[id] = value;
  return n;
}
export function renameOption(R: RateBook, id: string, label: string): RateBook {
  return { ...R, rateLabels: { ...R.rateLabels, [id]: label } };
}
export function removeOption(R: RateBook, groupId: string, id: string): RateBook {
  const n = structuredClone(R);
  const g = rateGroup(n, groupId);
  if (g) delete g[id];
  return n;
}
