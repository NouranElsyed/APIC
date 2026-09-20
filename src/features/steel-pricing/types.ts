export type PricingScope = "Supply" | "Site Activity";

/** The 11 per-ton install cost items. */
export type InstallRateKey =
  | "transportRate" | "handlingPerTon" | "packingPerTon" | "cranePerTon"
  | "scaffoldPerTon" | "manHourPerTon" | "safetyPerTon" | "toolsPerTon"
  | "ppePerTon" | "touchUpPerTon" | "weldSurveyorPerTon";

/** Everything a rate profile controls: the 11 per-ton rates + install indirect % + install margin %. */
export type ProfileKey = InstallRateKey | "installIndirectPct" | "installMarginPct";

/**
 * Rate profiles. The original sheet keeps 5 rows of install rates (crane, scaffolding, man-hours...)
 * and every BOQ item points at one of them per cost line. "A" = the standard rates edited in the
 * Rate Card (group 2); B–E are the extra sets.
 */
export type ProfileId = "A" | "B" | "C" | "D" | "E";
export type InstallProfiles = Record<Exclude<ProfileId, "A">, Record<ProfileKey, number>>;
/** Which profile each cost line of one BOQ item uses. Missing key = that cost line is not charged. */
export type ItemRateMap = Partial<Record<ProfileKey, ProfileId>>;

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
  /** Per-item install rate profile picks (from the original sheet). */
  rates?: ItemRateMap;
  /** Priced "like" another item (the sheet reuses unit prices: G = G<other row> × factor). */
  priceLike?: { no: string; factor: number };
  /** Hard-coded unit price from the sheet (overrides the calculation). */
  fixedUnitPrice?: number;
}

export interface PricingResult {
  /** Set when this item takes its unit price from another item. */
  linkedTo?: string;
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