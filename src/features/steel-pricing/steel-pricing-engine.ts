import { FAMILIES } from "./steel-pricing-data";
import type { InstallRateKey, MaterialFamily, PricingResult, PricingScope, PricingSettings } from "./types";

/** Effective per-ton install rate: the material's own override if set, otherwise the global rate. */
export function installRate(fam: MaterialFamily, S: PricingSettings, key: InstallRateKey): number {
  const o = fam.installOverrides?.[key];
  return typeof o === "number" ? o : S[key];
}

/**
 * Recreates the original pricing sheet's logic in one place:
 * material cost -> fabrication cost -> install cost -> overheads -> tax & insurance.
 */
export function calcItem(qtyRaw: number, famKey: string, scope: PricingScope, S: PricingSettings): PricingResult {
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

  const R = (k: InstallRateKey) => installRate(fam, S, k);
  let installDirect: number;
  if (isSupply) {
    installDirect = wQty * (R("transportRate") + R("handlingPerTon") + R("packingPerTon"));
  } else {
    installDirect =
      wQty *
      (R("transportRate") + R("handlingPerTon") + R("packingPerTon") + R("cranePerTon") +
        R("scaffoldPerTon") + R("manHourPerTon") + R("safetyPerTon") + R("toolsPerTon") +
        R("ppePerTon") + R("touchUpPerTon") + R("weldSurveyorPerTon"));
  }
  const installIndirect = installDirect * (S.installIndirectPct / 100);
  const installSale = (installDirect + installIndirect) * (1 + S.installMarginPct / 100);

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

export function fmt(n: number): string {
  if (!isFinite(n)) n = 0;
  return Math.round(n).toLocaleString("en-US");
}

export function fmt2(n: number): string {
  if (!isFinite(n)) n = 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}