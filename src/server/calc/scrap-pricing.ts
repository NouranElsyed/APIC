// Reproduces the "pricing" sheet of the reference Excel workbook
// (calculate_area_formatted.xlsx) column-for-column. See PROJECT.md for the
// material-flow spec:
//
//   Purchased Material -> Used Material -> Primary Scrap / Remaining
//     -> Used Later (retained + reused) & Actual Scrap (sold)
//
// Excel column letters are noted next to each field below so the mapping
// back to the source workbook stays traceable.

export interface ScrapPricingRowInput {
  /** Stable identifier for the row (material group key). */
  key: string;
  itemLabel: string;
  material: string;
  thicknessMm: number;

  // "Used Material" — actual DXF nested area/weight (B, C)
  usedAreaSqm: number;
  usedWeightKg: number;

  // "Purchased Material" — from the Nesting Engine's required-sheet
  // calculation (E, F, G)
  buyQty: number;
  buyAreaSqm: number;
  buyWeightKg: number;

  // Manual inputs (D, J, L, and the scrap-sell price which the Excel
  // hard-codes to 15 but PROJECT.md requires to be user-configurable) —
  // never hard-coded, always supplied by the caller.
  costPerKg: number;
  usedLaterPct: number; // 0..1
  usedLaterPriceLEPerKg: number;
  scrapSellPriceLEPerKg: number;
}

export interface ScrapPricingRowResult extends ScrapPricingRowInput {
  primaryScrapWeightKg: number; // buyWeight - usedWeight
  primaryScrapPct: number; // H = 1 - (used/buy)
  costUsedLE: number; // I = D*C
  weightUsedLaterKg: number; // K = (G-C)*J
  usedLaterCostLE: number; // M = K*D
  usedLaterValueLE: number; // N = K*L
  actualScrapWeightKg: number; // O = G-C-K
  actualScrapCostLE: number; // P = O*D  ("Selled Scrap Cost" — cost basis of scrap)
  scrapValueLE: number; // Q = O*scrapSellPrice ("Selled Scrap price")
  netScrapAdjustmentLE: number; // R = (P-Q)+(M-N)  ("scrap value" in the sheet)
  valueUsedLE: number; // S = I+Q+N  ("Value Used")
  buyCostLE: number; // T = D*G
  actualScrapPct: number; // U = 1 - (S/T)
}

export interface ScrapPricingTotals {
  totalUsedAreaSqm: number;
  totalUsedWeightKg: number;
  totalBuyWeightKg: number;
  totalBuyAreaSqm: number;
  totalPrimaryScrapWeightKg: number;
  totalCostUsedLE: number;
  totalWeightUsedLaterKg: number;
  totalUsedLaterCostLE: number;
  totalUsedLaterValueLE: number;
  totalActualScrapWeightKg: number;
  totalActualScrapCostLE: number;
  totalScrapValueLE: number;
  totalNetScrapAdjustmentLE: number;
  totalValueUsedLE: number;
  totalBuyCostLE: number;
  /** Weighted average Cost/kg = Total Cost Used / Total Used Weight (D17) */
  avgCostPerKg: number;
  /** "Scrap % from Bought Mat." (T19) = 1 - (Total Value Used / Total Buy Cost) */
  actualScrapPctFromBought: number;
  /** absolute LE value of the above (U19) */
  actualScrapValueFromBoughtLE: number;
  /** "Scrap % from Used Mat." (T20) = Total net scrap adjustment / Total Cost Used */
  actualScrapPctFromUsed: number;
  /** absolute LE value of the above (U20) */
  actualScrapValueFromUsedLE: number;
}

function safeDiv(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Purchased Material weight/area — direct pass-through from the Nesting Engine. */
export function calculatePurchasedMaterial(input: Pick<ScrapPricingRowInput, "buyQty" | "buyAreaSqm" | "buyWeightKg">) {
  return { buyQty: input.buyQty, buyAreaSqm: input.buyAreaSqm, buyWeightKg: input.buyWeightKg };
}

/** Used Material — actual DXF nested area/weight, never bounding-box. */
export function calculateUsedMaterial(input: Pick<ScrapPricingRowInput, "usedAreaSqm" | "usedWeightKg">) {
  return { usedAreaSqm: input.usedAreaSqm, usedWeightKg: input.usedWeightKg };
}

/** Primary Scrap = Purchased Weight - Used Weight (Excel H, as weight + %). */
export function calculatePrimaryScrap(buyWeightKg: number, usedWeightKg: number) {
  const primaryScrapWeightKg = buyWeightKg - usedWeightKg;
  const primaryScrapPct = 1 - safeDiv(usedWeightKg, buyWeightKg);
  return { primaryScrapWeightKg, primaryScrapPct };
}

/** Used Later portion of Primary Scrap (Excel K, M, N). */
export function calculateUsedLater(
  buyWeightKg: number,
  usedWeightKg: number,
  usedLaterPct: number,
  costPerKg: number,
  usedLaterPriceLEPerKg: number,
) {
  const weightUsedLaterKg = (buyWeightKg - usedWeightKg) * usedLaterPct;
  const usedLaterCostLE = weightUsedLaterKg * costPerKg;
  const usedLaterValueLE = weightUsedLaterKg * usedLaterPriceLEPerKg;
  return { weightUsedLaterKg, usedLaterCostLE, usedLaterValueLE };
}

/** Actual Scrap = Primary Scrap - Used Later (Excel O, P, Q). */
export function calculateActualScrap(
  buyWeightKg: number,
  usedWeightKg: number,
  weightUsedLaterKg: number,
  costPerKg: number,
  scrapSellPriceLEPerKg: number,
) {
  const actualScrapWeightKg = buyWeightKg - usedWeightKg - weightUsedLaterKg;
  const actualScrapCostLE = actualScrapWeightKg * costPerKg;
  const scrapValueLE = actualScrapWeightKg * scrapSellPriceLEPerKg;
  return { actualScrapWeightKg, actualScrapCostLE, scrapValueLE };
}

/** Excel R/S/T/U — net scrap adjustment, value used, buy cost, actual scrap %. */
export function calculateScrapValue(params: {
  costUsedLE: number;
  actualScrapCostLE: number;
  scrapValueLE: number;
  usedLaterCostLE: number;
  usedLaterValueLE: number;
  buyWeightKg: number;
  costPerKg: number;
}) {
  const { costUsedLE, actualScrapCostLE, scrapValueLE, usedLaterCostLE, usedLaterValueLE, buyWeightKg, costPerKg } = params;
  const netScrapAdjustmentLE = (actualScrapCostLE - scrapValueLE) + (usedLaterCostLE - usedLaterValueLE);
  const valueUsedLE = costUsedLE + scrapValueLE + usedLaterValueLE;
  const buyCostLE = costPerKg * buyWeightKg;
  const actualScrapPct = 1 - safeDiv(valueUsedLE, buyCostLE);
  return { netScrapAdjustmentLE, valueUsedLE, buyCostLE, actualScrapPct };
}

/** Computes one full pricing row, matching every column of the Excel sheet. */
export function calculateScrapPricingRow(input: ScrapPricingRowInput): ScrapPricingRowResult {
  const { buyWeightKg, usedWeightKg, costPerKg, usedLaterPct, usedLaterPriceLEPerKg } = input;

  const costUsedLE = costPerKg * usedWeightKg; // I

  const { primaryScrapWeightKg, primaryScrapPct } = calculatePrimaryScrap(buyWeightKg, usedWeightKg);

  const { weightUsedLaterKg, usedLaterCostLE, usedLaterValueLE } = calculateUsedLater(
    buyWeightKg, usedWeightKg, usedLaterPct, costPerKg, usedLaterPriceLEPerKg,
  );

  const { actualScrapWeightKg, actualScrapCostLE, scrapValueLE } = calculateActualScrap(
    buyWeightKg, usedWeightKg, weightUsedLaterKg, costPerKg, input.scrapSellPriceLEPerKg,
  );

  const { netScrapAdjustmentLE, valueUsedLE, buyCostLE, actualScrapPct } = calculateScrapValue({
    costUsedLE, actualScrapCostLE, scrapValueLE, usedLaterCostLE, usedLaterValueLE, buyWeightKg, costPerKg,
  });

  return {
    ...input,
    primaryScrapWeightKg,
    primaryScrapPct,
    costUsedLE,
    weightUsedLaterKg,
    usedLaterCostLE,
    usedLaterValueLE,
    actualScrapWeightKg,
    actualScrapCostLE,
    scrapValueLE,
    netScrapAdjustmentLE,
    valueUsedLE,
    buyCostLE,
    actualScrapPct,
  };
}

/** Sum-based totals — never an average of row percentages (matches T19/T20). */
export function calculateScrapPricingTotals(rows: ScrapPricingRowResult[]): ScrapPricingTotals {
  const sum = (f: (r: ScrapPricingRowResult) => number) => rows.reduce((s, r) => s + f(r), 0);

  const totalUsedAreaSqm = sum((r) => r.usedAreaSqm);
  const totalUsedWeightKg = sum((r) => r.usedWeightKg);
  const totalBuyWeightKg = sum((r) => r.buyWeightKg);
  const totalBuyAreaSqm = sum((r) => r.buyAreaSqm);
  const totalCostUsedLE = sum((r) => r.costUsedLE);
  const totalWeightUsedLaterKg = sum((r) => r.weightUsedLaterKg);
  const totalUsedLaterCostLE = sum((r) => r.usedLaterCostLE);
  const totalUsedLaterValueLE = sum((r) => r.usedLaterValueLE);
  const totalActualScrapWeightKg = sum((r) => r.actualScrapWeightKg);
  const totalActualScrapCostLE = sum((r) => r.actualScrapCostLE);
  const totalScrapValueLE = sum((r) => r.scrapValueLE);
  const totalNetScrapAdjustmentLE = sum((r) => r.netScrapAdjustmentLE);
  const totalValueUsedLE = sum((r) => r.valueUsedLE);
  const totalBuyCostLE = sum((r) => r.buyCostLE);

  const avgCostPerKg = safeDiv(totalCostUsedLE, totalUsedWeightKg);
  const actualScrapPctFromBought = 1 - safeDiv(totalValueUsedLE, totalBuyCostLE);
  const actualScrapValueFromBoughtLE = actualScrapPctFromBought * totalBuyCostLE;
  const actualScrapPctFromUsed = safeDiv(totalNetScrapAdjustmentLE, totalCostUsedLE);
  const actualScrapValueFromUsedLE = actualScrapPctFromUsed * totalCostUsedLE;

  return {
    totalUsedAreaSqm,
    totalUsedWeightKg,
    totalBuyWeightKg,
    totalBuyAreaSqm,
    totalPrimaryScrapWeightKg: totalBuyWeightKg - totalUsedWeightKg,
    totalCostUsedLE,
    totalWeightUsedLaterKg,
    totalUsedLaterCostLE,
    totalUsedLaterValueLE,
    totalActualScrapWeightKg,
    totalActualScrapCostLE,
    totalScrapValueLE,
    totalNetScrapAdjustmentLE,
    totalValueUsedLE,
    totalBuyCostLE,
    avgCostPerKg,
    actualScrapPctFromBought,
    actualScrapValueFromBoughtLE,
    actualScrapPctFromUsed,
    actualScrapValueFromUsedLE,
  };
}
