import { DEFAULT_ITEMS, DEFAULT_MATERIALS, DEFAULT_RATES } from "./steel-pricing-data";
import type { CustomLine, ItemOverride, MaterialTable, Overrides, ProfileRates, RateBook } from "./types";

/**
 * Versioned persistence. Everything editable lives in one document:
 *   rates      – the whole rate card (materials' companions, fabrication, installation profiles A–E, extras, tax)
 *   materials  – material prices (previously NOT persisted)
 *   overrides  – per-item edits: quantity, material, install profile per activity
 * Bump STORAGE_VERSION when the shape changes; older documents are merged over the defaults, never trusted blindly.
 */
export const STORAGE_KEY = "steelPricing.state";
export const STORAGE_VERSION = 2;
const LEGACY_ITEMS_KEY = "steelflow_pricing_items_v1";

export interface PricingState {
  rates: RateBook;
  materials: MaterialTable;
  overrides: Overrides;
}

export function defaultState(): PricingState {
  return {
    rates: structuredClone(DEFAULT_RATES),
    materials: structuredClone(DEFAULT_MATERIALS),
    overrides: {},
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && isFinite(v);

const OPTION_ID = /^[A-Za-z0-9_-]{1,32}$/;

/** Built-in profiles A–E plus any rate option the user added (kept under its own id). */
function mergeProfiles(base: ProfileRates, saved: unknown): ProfileRates {
  const out: ProfileRates = { ...base };
  if (saved && typeof saved === "object") {
    for (const [p, v] of Object.entries(saved as ProfileRates)) {
      if (OPTION_ID.test(p) && isNum(v)) out[p] = v;
    }
  }
  return out;
}

function mergeRates(saved: unknown): RateBook {
  const base = structuredClone(DEFAULT_RATES);
  if (!saved || typeof saved !== "object") return base;
  const s = saved as Record<string, unknown>;
  const labels = s.rateLabels;
  if (labels && typeof labels === "object") {
    for (const [id, name] of Object.entries(labels as Record<string, unknown>)) {
      if (OPTION_ID.test(id) && typeof name === "string" && name.trim()) base.rateLabels[id] = name.slice(0, 60);
    }
  }
  for (const k of ["handling", "scrap", "accessories", "inflation", "cutting", "rolling", "subcontract", "welding", "painting", "paintingArea", "ndt", "fabIndirect", "installIndirect", "installMargin", "tax", "insurance"] as const) {
    base[k] = mergeProfiles(base[k], s[k]);
  }
  for (const k of Object.keys(base.install) as (keyof RateBook["install"])[]) {
    base.install[k] = mergeProfiles(base.install[k], (s.install as Record<string, unknown> | undefined)?.[k]);
  }
  for (const k of Object.keys(base.margins) as (keyof RateBook["margins"])[]) {
    const v = (s.margins as Record<string, unknown> | undefined)?.[k];
    if (isNum(v)) base.margins[k] = v;
  }
  for (const k of ["mobDemob", "heightFactor", "thirdParty", "commissioning", "subcontractMargin"] as const) {
    if (isNum(s[k])) base[k] = s[k] as number;
  }
  return base;
}

function mergeMaterials(saved: unknown): MaterialTable {
  const base = structuredClone(DEFAULT_MATERIALS);
  if (saved && typeof saved === "object") {
    for (const row of Object.keys(base)) {
      const v = (saved as Record<string, { price?: unknown }>)[row]?.price;
      if (isNum(v)) base[Number(row)].price = v;
    }
  }
  return base;
}

function isCustomLine(c: unknown): c is CustomLine {
  const l = c as CustomLine;
  return !!l && typeof l === "object" && typeof l.id === "string" && typeof l.label === "string" && isNum(l.rate) && typeof l.enabled === "boolean" &&
    (l.group === "material" || l.group === "fabrication" || l.group === "installation") && (l.basis === "perUnit" || l.basis === "fixed");
}

function cleanOverrides(saved: unknown): Overrides {
  const out: Overrides = {};
  if (!saved || typeof saved !== "object") return out;
  const valid = new Set(DEFAULT_ITEMS.map((i) => i.no));
  for (const [no, ov] of Object.entries(saved as Overrides)) {
    if (!valid.has(no) || !ov || typeof ov !== "object") continue;
    const clean: ItemOverride = { ...ov };
    // User-added lines and checkbox choices come from localStorage, so never trust their shape.
    if (clean.custom !== undefined) {
      clean.custom = Array.isArray(clean.custom) ? clean.custom.filter(isCustomLine) : undefined;
      if (!clean.custom?.length) delete clean.custom;
    }
    if (clean.toggles !== undefined) {
      const t = clean.toggles && typeof clean.toggles === "object" ? Object.entries(clean.toggles).filter(([, v]) => typeof v === "boolean") : [];
      if (t.length) clean.toggles = Object.fromEntries(t); else delete clean.toggles;
    }
    if (clean.rates !== undefined) {
      const r = clean.rates && typeof clean.rates === "object" ? Object.entries(clean.rates).filter(([, v]) => typeof v === "string" && OPTION_ID.test(v)) : [];
      if (r.length) clean.rates = Object.fromEntries(r); else delete clean.rates;
    }
    out[no] = clean;
  }
  return out;
}

/** Old (v1) documents only stored quantities by item id; carry those over so users keep their edits. */
function migrateLegacy(): Overrides {
  try {
    const raw = window.localStorage.getItem(LEGACY_ITEMS_KEY);
    if (!raw) return {};
    const saved = JSON.parse(raw) as { id: number; qty: number }[];
    const out: Overrides = {};
    for (const s of saved) {
      const item = DEFAULT_ITEMS[s.id - 1];
      if (item && isNum(s.qty) && s.qty !== item.qty) out[item.no] = { qty: s.qty };
    }
    return out;
  } catch {
    return {};
  }
}

export function loadState(): PricingState {
  const def = defaultState();
  if (typeof window === "undefined") return def;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...def, overrides: migrateLegacy() };
    const doc = JSON.parse(raw) as { version?: number } & Partial<PricingState>;
    if (doc.version !== STORAGE_VERSION) return { ...def, overrides: migrateLegacy() };
    return { rates: mergeRates(doc.rates), materials: mergeMaterials(doc.materials), overrides: cleanOverrides(doc.overrides) };
  } catch {
    return def;
  }
}

export function saveState(state: PricingState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...state }));
  } catch {
    // quota / privacy mode
  }
}
