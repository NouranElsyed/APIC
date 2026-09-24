/**
 * Steel Pricing model — mirrors the "BOQ - Full" sheet of `Cost Estimation- Steel Structure.xlsx`.
 *
 * Rate profiles: the workbook keeps five alternative rates per activity (rate-card rows 15…11).
 * They are exposed as Profile A (row 15, the default) … Profile E (row 11). The workbook does not
 * name B–E, so neither do we.
 */
export type Profile = "A" | "B" | "C" | "D" | "E";
export const PROFILES: Profile[] = ["A", "B", "C", "D", "E"];

export type PaintBasis = "ton" | "area";
export type PricingScope = "Supply" | "Site Activity";
export type ProfileRates = Partial<Record<Profile, number>>;

export type InstallKey =
  | "transport" | "handling" | "packing" | "crane" | "scaffolding" | "manHour"
  | "safety" | "tools" | "ppe" | "touchUp" | "weldSurveyor";

export const INSTALL_KEYS: InstallKey[] = [
  "transport", "handling", "packing", "crane", "scaffolding", "manHour",
  "safety", "tools", "ppe", "touchUp", "weldSurveyor",
];

/** Rate card. Percent-like values are stored as fractions (0.07 = 7%); tax & insurance as divisors (0.99). */
export interface RateBook {
  handling: ProfileRates;
  scrap: ProfileRates;
  accessories: ProfileRates;
  /** Inflation allowance on material price (workbook "Inflation" column). 0 unless the user sets it. */
  inflation: ProfileRates;
  cutting: ProfileRates;
  /** Rolling, EGP per ton (workbook "Rolling" column; 0 for every workbook item). */
  rolling: ProfileRates;
  welding: ProfileRates;
  painting: ProfileRates;
  /** Painting per m² (EGP/m²). Not in the workbook, so it starts empty and is entered by the user. */
  paintingArea: ProfileRates;
  ndt: ProfileRates;
  fabIndirect: ProfileRates;
  /** Subcontractor cost, EGP per item unit (workbook "Subcontractor" column). 0 unless the user sets it. */
  subcontract: ProfileRates;
  /** Multiplier applied to the subcontractor cost to get its sale price (workbook "Subcontract Sale Price"). */
  subcontractMargin: number;
  margins: { material: number; fabrication: number; ndt: number; painting: number };
  install: Record<InstallKey, ProfileRates>;
  installIndirect: ProfileRates;
  installMargin: ProfileRates;
  mobDemob: number;
  heightFactor: number;
  thirdParty: number;
  commissioning: number;
  tax: ProfileRates;
  insurance: ProfileRates;
}

export interface MaterialRow {
  label: string;
  unit: string;
  price: number;
}
/** Keyed by the material's row number in the workbook's rate card (1–15). */
export type MaterialTable = Record<number, MaterialRow>;

export interface InstallLineSpec {
  p: Profile;
  /** Constant factor from the workbook formula (e.g. 0.05). */
  k: number;
  /** Multiplied by the item's unit weight (tons per unit) when true. */
  wt: boolean;
}

/** Where a user-added line lands in the cost build-up (and which margin it picks up). */
export type CustomGroup = "material" | "fabrication" | "installation";
/** "perUnit" = rate × item quantity; "fixed" = lump sum for the whole item. */
export type CustomBasis = "perUnit" | "fixed";

/** A line the user adds to one item (e.g. "Hot rolled"), with its own on/off checkbox. */
export interface CustomLine {
  id: string;
  label: string;
  group: CustomGroup;
  basis: CustomBasis;
  rate: number;
  enabled: boolean;
}

/**
 * Ids of the components that can be ticked on/off per item:
 * handling · scrap · accessories · cutting · welding · ndt · painting · fabIndirect ·
 * mob · height · thirdParty · commissioning · install.<InstallKey>
 */
export type ComponentId = string;

export interface CalcSpec {
  unitWt: number;
  matRow: number | null;
  handling: boolean;
  scrap: Profile | null;
  accessories: Profile | null;
  scrapLink?: { item: string; profile: Profile };
  accessoriesLink?: { item: string; k: number };
  cutting: Profile | null;
  welding: Profile | null;
  painting: Profile | null;
  paintingRate?: number;
  paintingMargin?: number;
  /** Painting basis: per ton of steel (workbook default) or per m² of painted area. */
  paintBasis?: PaintBasis;
  /** Painted area in m² (used when paintBasis = "area"). */
  paintArea?: number;
  ndt: boolean;
  fabIndirect: Profile | null;
  /** Optional components: off unless the user ticks them (not part of the workbook items). */
  inflation?: boolean;
  rolling?: boolean;
  subcontract?: boolean;
  install: Partial<Record<InstallKey, InstallLineSpec>>;
  /** User-added lines (only present through an override). */
  custom?: CustomLine[];
  installIndirect: Profile;
  installMargin: Profile;
  mob: boolean;
  height: boolean;
  thirdParty: boolean;
  commissioning: boolean;
  tax: Profile;
  insurance: Profile;
}

interface BoqBase {
  no: string;
  sec: "supply" | "install";
  sub: string;
  scope: PricingScope;
  desc: string;
  grade: string;
  unit: string;
  qty: number;
}
export type BoqItem =
  | (BoqBase & { mode: "calc"; spec: CalcSpec })
  | (BoqBase & { mode: "pricedLike"; like: { src: string; mult: number } })
  | (BoqBase & { mode: "fixed"; fixed: number })
  | (BoqBase & { mode: "unpriced" });

/** User edits kept on top of the workbook defaults. */
export interface ItemOverride {
  qty?: number;
  matRow?: number | null;
  paintBasis?: PaintBasis;
  paintArea?: number;
  /** Per-activity install profile overrides. */
  install?: Partial<Record<InstallKey, Profile>>;
  /** Checkbox choices that differ from the workbook default: componentId → on/off. */
  toggles?: Record<ComponentId, boolean>;
  /** Lines the user added to this item. */
  custom?: CustomLine[];
}
export type Overrides = Record<string, ItemOverride>;

export interface InstallLineResult {
  key: InstallKey;
  profile: Profile;
  rate: number;
  factor: number;
  weight: number;
  amount: number;
}

export interface CustomLineResult extends CustomLine {
  /** 0 when the line is unchecked. */
  amount: number;
}

export interface CalcResult {
  mode: "calc";
  qty: number;
  weight: number;
  // 1. material
  matRow: number | null;
  materialRate: number;
  materialPrice: number;
  handling: number;
  scrap: number;
  accessories: number;
  inflation: number;
  customMaterial: number;
  materialCost: number;
  // 2. fabrication
  cutting: number;
  welding: number;
  rolling: number;
  customFabrication: number;
  fabricationCost: number; // cutting + rolling + fit-up & welding + custom fabrication lines
  ndt: number;
  painting: number;
  paintBasis: PaintBasis;
  paintArea: number;
  paintRate: number;
  totalFabricationCost: number;
  fabIndirect: number;
  supplySalePrice: number;
  /** Subcontractor cost and its sale price (cost × subcontract margin). */
  subcontract: number;
  subcontractSale: number;
  // 3. installation
  installLines: InstallLineResult[];
  customInstall: number;
  /** Every user-added line (all groups), in the order the user added them. */
  customLines: CustomLineResult[];
  installDirect: number;
  installIndirect: number;
  installSale: number;
  supplyAndInstall: number;
  // 4. additional
  mobDemob: number;
  heightFactor: number;
  thirdParty: number;
  beforeCommissioning: number;
  commissioning: number;
  totalSale: number;
  // 5. tax & insurance
  tax: number;
  insurance: number;
  // final
  finalPrice: number;
  unitPrice: number;
  totalCost: number;
  profit: number;
  profitPct: number;
}

export type ItemResult =
  | CalcResult
  | { mode: "pricedLike"; qty: number; src: string; mult: number; srcUnitPrice: number; unitPrice: number; finalPrice: number; totalCost: number | null; profit: number | null; profitPct: number | null }
  | { mode: "fixed"; qty: number; unitPrice: number; finalPrice: number; totalCost: null; profit: null; profitPct: null }
  | { mode: "unpriced"; qty: number; unitPrice: 0; finalPrice: 0; totalCost: null; profit: null; profitPct: null };

export interface BoqTotals {
  supply: number;
  install: number;
  grand: number;
  /** Cost/profit cover only items the workbook gives a cost for (calculated + priced-like). */
  totalCost: number;
  profit: number;
  profitPct: number;
  pricedItems: number;
  costedItems: number;
  additional: number; // mob + height + third party + commissioning across calculated items
  taxInsurance: number;
  weight: number;
}
export interface BoqResult {
  items: Record<string, ItemResult>;
  totals: BoqTotals;
}
