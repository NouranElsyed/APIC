export type PricingScope = "Supply" | "Site Activity";

export interface MaterialFamily {
  name: string;
  unit: string;
  materialPrice: number;
  weldingRate: number;
  paintingRate: number;
  scrapPct: number;
  /** Converts a piece/area quantity into an equivalent tonnage for per-ton install rates. */
  weightFactor?: number;
  /** True for placeholder families that had no price in the source sheet. */
  flag?: boolean;
}

export interface PricingSettings {
  // Group 1 — material & fabrication cost
  handlingPct: number;
  ndtPct: number;
  fabIndirectPct: number;
  materialMargin: number;
  fabMargin: number;
  ndtMargin: number;
  paintMargin: number;
  // Group 2 — installation cost (per ton)
  transportRate: number;
  handlingPerTon: number;
  packingPerTon: number;
  cranePerTon: number;
  scaffoldPerTon: number;
  manHourPerTon: number;
  safetyPerTon: number;
  toolsPerTon: number;
  ppePerTon: number;
  touchUpPerTon: number;
  weldSurveyorPerTon: number;
  installIndirectPct: number;
  installMarginPct: number;
  // Group 3 — additional costs (installation items only)
  mobDemobPct: number;
  thirdPartyCertPct: number;
  heightFactorPct: number;
  commissioningPct: number;
  // Group 4 — tax & insurance (all items)
  taxPct: number;
  insurancePct: number;
}

export interface BoqItem {
  id: number;
  sec: "supply" | "install";
  sub: string;
  no: string;
  scope: PricingScope;
  desc: string;
  grade: string;
  unit: string;
  qty: number;
  fam: string;
}

export interface PricingResult {
  flag: boolean;
  materialPrice: number;
  handling: number;
  scrap: number;
  materialCost: number;
  welding: number;
  painting: number;
  ndt: number;
  totalFabricationCost: number;
  fabIndirect: number;
  supplySalePrice: number;
  installDirect: number;
  installIndirect: number;
  installSale: number;
  mobDemob: number;
  thirdParty: number;
  heightFactor: number;
  commissioning: number;
  finalSalePrice: number;
  unitPrice: number;
  total: number;
  totalCost: number;
  profit: number;
  profitPct: number;
}
