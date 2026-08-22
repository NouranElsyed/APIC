export interface ScrapPricingRow {
  key: string;
  itemLabel: string;
  material: string;
  thicknessMm: number;
  usedAreaSqm: number;
  usedWeightKg: number;
  buyQty: number;
  buyAreaSqm: number;
  buyWeightKg: number;
  costPerKg: number;
  usedLaterPct: number;
  usedLaterPriceLEPerKg: number;
  scrapSellPriceLEPerKg: number;
  primaryScrapWeightKg: number;
  primaryScrapPct: number;
  costUsedLE: number;
  weightUsedLaterKg: number;
  usedLaterCostLE: number;
  usedLaterValueLE: number;
  actualScrapWeightKg: number;
  actualScrapCostLE: number;
  scrapValueLE: number;
  netScrapAdjustmentLE: number;
  valueUsedLE: number;
  buyCostLE: number;
  actualScrapPct: number;
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
  avgCostPerKg: number;
  actualScrapPctFromBought: number;
  actualScrapValueFromBoughtLE: number;
  actualScrapPctFromUsed: number;
  actualScrapValueFromUsedLE: number;
}

export interface ScrapPricingResult {
  nestingRunId: string;
  rows: ScrapPricingRow[];
  totals: ScrapPricingTotals;
}

export interface ScrapPricingGlobalInputs {
  costPerKg: number;
  usedLaterPct: number; // 0..1 (UI works in 0..100 and converts)
  usedLaterPriceLEPerKg: number;
  scrapSellPriceLEPerKg: number;
}
