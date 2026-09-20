import { FAMILIES } from "./steel-pricing-data";
import { DEFAULT_PROFILES } from "./steel-pricing-data";
import type { BoqItem, InstallProfiles, InstallRateKey, ItemRateMap, PricingResult, PricingScope, PricingSettings, ProfileId, ProfileKey } from "./types";

export const PER_TON_KEYS: InstallRateKey[] = [
  "transportRate", "handlingPerTon", "packingPerTon", "cranePerTon", "scaffoldPerTon", "manHourPerTon",
  "safetyPerTon", "toolsPerTon", "ppePerTon", "touchUpPerTon", "weldSurveyorPerTon",
];
const SUPPLY_KEYS: InstallRateKey[] = ["transportRate", "handlingPerTon", "packingPerTon"];

/** Value of one cost line under a given profile. "A" is the standard rate card (settings). */
export function profileValue(id: ProfileId, key: ProfileKey, S: PricingSettings, profiles: InstallProfiles): number {
  return id === "A" ? S[key] : profiles[id][key];
}

/** Default rate map when no per-item map exists (e.g. the quick calculator): every line on one profile. */
export function defaultRateMap(scope: PricingScope, profile: ProfileId = "A"): ItemRateMap {
  const keys = scope === "Supply" ? SUPPLY_KEYS : PER_TON_KEYS;
  const m: ItemRateMap = { installIndirectPct: profile, installMarginPct: profile };
  keys.forEach((k) => { m[k] = profile; });
  return m;
}

/** Resolve a rate map into actual numbers. Unmapped per-ton lines are 0; unmapped % lines use the standard rate. */
export function resolveRates(
  S: PricingSettings, profiles: InstallProfiles, map: ItemRateMap,
): Record<ProfileKey, number> {
  const out = {} as Record<ProfileKey, number>;
  PER_TON_KEYS.forEach((k) => { out[k] = map[k] ? profileValue(map[k] as ProfileId, k, S, profiles) : 0; });
  (["installIndirectPct", "installMarginPct"] as const).forEach((k) => {
    out[k] = profileValue(map[k] || "A", k, S, profiles);
  });
  return out;
}

/**
 * Recreates the original pricing sheet's logic in one place:
 * material cost -> fabrication cost -> install cost -> overheads -> tax & insurance.
 */
export function calcItem(
  qtyRaw: number, famKey: string, scope: PricingScope, S: PricingSettings,
  rateMap?: ItemRateMap, profiles: InstallProfiles = DEFAULT_PROFILES,
): PricingResult {
  const fam = FAMILIES[famKey] || FAMILIES.st37;
  const qty = Number(qtyRaw) || 0;

  if (fam.flag) {
    return {
      flag: true, materialPrice: 0, handling: 0, scrap: 0, materialCost: 0,
      welding: 0, painting: 0, ndt: 0, totalFabricationCost: 0, fabIndirect: 0,
      supplySalePrice: 0, installDirect: 0, installIndirect: 0, installSale: 0,
      mobDemob: 0, thirdParty: 0, heightFactor: 0, commissioning: 0,
      finalSalePrice: 0, unitPrice: 0, total: 0, totalCost: 0, profit: 0, profitPct: 0,
    };
  }

  const isSupply = scope === "Supply";
  // Rates named "per ton" only make sense against the item's actual steel weight;
  // for area/piece-based items (cladding, grating, poly sheet...) we convert qty
  // to an equivalent tonnage before applying those rates. Ton/LM-based families pass through as-is.
  const wQty = qty * (fam.weightFactor || 1);

  let materialPrice = 0, handling = 0, scrap = 0, materialCost = 0;
  let welding = 0, painting = 0, ndt = 0, totalFabricationCost = 0, fabIndirect = 0, supplySalePrice = 0;

  if (isSupply) {
    materialPrice = qty * fam.materialPrice;
    handling = materialPrice * (S.handlingPct / 100);
    scrap = materialPrice * (fam.scrapPct / 100);
    materialCost = materialPrice + handling + scrap;

    welding = wQty * fam.weldingRate;
    painting = wQty * fam.paintingRate;
    ndt = welding * (S.ndtPct / 100);
    totalFabricationCost = materialCost + welding + ndt + painting;
    fabIndirect = totalFabricationCost * (S.fabIndirectPct / 100);

    supplySalePrice =
      materialCost * (1 + S.materialMargin / 100) +
      welding * (1 + S.fabMargin / 100) +
      ndt * (1 + S.ndtMargin / 100) +
      painting * (1 + S.paintMargin / 100);
  }

  const rates = resolveRates(S, profiles, rateMap || defaultRateMap(scope));
  const installDirect = wQty * PER_TON_KEYS.reduce((sum, k) => sum + rates[k], 0);
  const installIndirect = installDirect * (rates.installIndirectPct / 100);
  const installSale = (installDirect + installIndirect) * (1 + rates.installMarginPct / 100);

  let mobDemob = 0, thirdParty = 0, heightFactor = 0;
  const baseForOverhead = supplySalePrice + installSale;
  if (!isSupply) {
    mobDemob = baseForOverhead * (S.mobDemobPct / 100);
    thirdParty = baseForOverhead * (S.thirdPartyCertPct / 100);
    heightFactor = baseForOverhead * (S.heightFactorPct / 100);
  }
  const beforeCommission = baseForOverhead + mobDemob + thirdParty + heightFactor;
  const commissioning = beforeCommission * (S.commissioningPct / 100);
  const beforeTax = beforeCommission + commissioning;

  const finalSalePrice = beforeTax * (1 + S.taxPct / 100) * (1 + S.insurancePct / 100);
  const unitPrice = qty > 0 ? finalSalePrice / qty : 0;

  const totalCost =
    materialCost + welding + ndt + painting + fabIndirect +
    installDirect + installIndirect + mobDemob + thirdParty + heightFactor + commissioning;
  const profit = finalSalePrice - totalCost;
  const profitPct = totalCost > 0 ? (profit / totalCost) * 100 : 0;

  return {
    flag: false, materialPrice, handling, scrap, materialCost,
    welding, painting, ndt, totalFabricationCost, fabIndirect,
    supplySalePrice, installDirect, installIndirect, installSale,
    mobDemob, thirdParty, heightFactor, commissioning,
    finalSalePrice, unitPrice, total: finalSalePrice, totalCost, profit, profitPct,
  };
}

/**
 * Prices the whole BOQ. Items with a fixed unit price or a "priced like item X" link take their unit price
 * from there (exactly like the original sheet); everything else runs through calcItem.
 */
export function calcBoq(
  items: BoqItem[], S: PricingSettings, profiles: InstallProfiles,
): Record<number, PricingResult> {
  const byNo = new Map(items.map((it) => [it.no, it]));
  const own = new Map<number, PricingResult>();
  const out: Record<number, PricingResult> = {};

  function ownResult(it: BoqItem): PricingResult {
    let r = own.get(it.id);
    if (!r) { r = calcItem(it.qty, it.fam, it.scope, S, it.rates, profiles); own.set(it.id, r); }
    return r;
  }
  function unitOf(it: BoqItem, depth: number): { unit: number; profitPct: number } {
    if (it.fixedUnitPrice !== undefined) return { unit: it.fixedUnitPrice, profitPct: 0 };
    if (it.priceLike && depth < 10) {
      const src = byNo.get(it.priceLike.no);
      if (src) {
        const s = unitOf(src, depth + 1);
        return { unit: s.unit * it.priceLike.factor, profitPct: s.profitPct };
      }
    }
    const r = ownResult(it);
    return { unit: r.flag ? 0 : r.unitPrice, profitPct: r.profitPct };
  }

  items.forEach((it) => {
    if (it.fixedUnitPrice !== undefined || it.priceLike) {
      const { unit, profitPct } = unitOf(it, 0);
      const total = unit * (Number(it.qty) || 0);
      const base = ownResult({ ...it, fam: it.fam === "unpriced" ? "st37" : it.fam });
      out[it.id] = {
        ...base, flag: false, linkedTo: it.priceLike?.no ?? "fixed",
        finalSalePrice: total, total, unitPrice: unit, profitPct,
        profit: total - total / (1 + profitPct / 100), totalCost: total / (1 + profitPct / 100),
      };
    } else {
      out[it.id] = ownResult(it);
    }
  });
  return out;
}

export function fmt(n: number): string {
  if (!isFinite(n)) n = 0;
  return Math.round(n).toLocaleString("en-US");
}

export function fmt2(n: number): string {
  if (!isFinite(n)) n = 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}