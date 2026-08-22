import { describe, expect, it } from "vitest";
import { calculateScrapPricingRow, calculateScrapPricingTotals, type ScrapPricingRowInput } from "./scrap-pricing";

// Fixtures taken verbatim from calculate_area_formatted.xlsx ("pricing" sheet).
// Scrap sell price in the source workbook is hard-coded to 15 LE/kg — passed
// explicitly here since our implementation makes it a configurable input.

function row(overrides: Partial<ScrapPricingRowInput>): ScrapPricingRowInput {
  return {
    key: "test",
    itemLabel: "test",
    material: "Steel",
    thicknessMm: 8,
    usedAreaSqm: 0,
    usedWeightKg: 0,
    buyQty: 0,
    buyAreaSqm: 0,
    buyWeightKg: 0,
    costPerKg: 46,
    usedLaterPct: 0,
    usedLaterPriceLEPerKg: 46,
    scrapSellPriceLEPerKg: 15,
    ...overrides,
  };
}

describe("calculateScrapPricingRow", () => {
  it("matches the PL 8 mm row from the reference Excel", () => {
    const result = calculateScrapPricingRow(row({
      itemLabel: "PL 8 mm",
      usedAreaSqm: 31.32,
      usedWeightKg: 1966.896,
      buyQty: 5,
      buyAreaSqm: 0,
      buyWeightKg: 2826,
      usedLaterPct: 0.5,
    }));

    expect(result.primaryScrapPct).toBeCloseTo(0.304, 6);
    expect(result.costUsedLE).toBeCloseTo(90477.216, 3);
    expect(result.weightUsedLaterKg).toBeCloseTo(429.552, 3);
    expect(result.usedLaterCostLE).toBeCloseTo(19759.392, 3);
    expect(result.usedLaterValueLE).toBeCloseTo(19759.392, 3);
    expect(result.actualScrapWeightKg).toBeCloseTo(429.552, 3);
    expect(result.actualScrapCostLE).toBeCloseTo(19759.392, 3);
    expect(result.scrapValueLE).toBeCloseTo(6443.28, 2);
    expect(result.netScrapAdjustmentLE).toBeCloseTo(13316.112, 2);
    expect(result.valueUsedLE).toBeCloseTo(116679.888, 2);
    expect(result.buyCostLE).toBeCloseTo(129996, 2);
    expect(result.actualScrapPct).toBeCloseTo(0.102434782608696, 6);
  });

  it("matches the FB 80x10 row, including its negative primary-scrap edge case", () => {
    // This row is unusual: used weight slightly exceeds the calculated buy
    // weight, so primary scrap / actual scrap come out negative in the
    // source Excel too — the implementation must reproduce that, not clamp it.
    const result = calculateScrapPricingRow(row({
      itemLabel: "FB 80 x 10",
      usedAreaSqm: 0.747008,
      usedWeightKg: 58.640128,
      buyQty: 3,
      buyWeightKg: 56.52,
      usedLaterPct: 0.5,
    }));

    expect(result.primaryScrapPct).toBeCloseTo(-0.0375111111111113, 6);
    expect(result.weightUsedLaterKg).toBeCloseTo(-1.060064, 5);
    expect(result.actualScrapWeightKg).toBeCloseTo(-1.060064, 5);
    expect(result.scrapValueLE).toBeCloseTo(-15.90096, 3);
    expect(result.actualScrapPct).toBeCloseTo(-0.0126396135265701, 6);
  });

  it("matches the FB 115x10 row where %UsedLater is 0", () => {
    const result = calculateScrapPricingRow(row({
      itemLabel: "FB 115 x 10",
      usedAreaSqm: 2.00376,
      usedWeightKg: 78.64758,
      buyQty: 4,
      buyWeightKg: 216.66,
      usedLaterPct: 0,
    }));

    expect(result.weightUsedLaterKg).toBe(0);
    expect(result.actualScrapWeightKg).toBeCloseTo(138.01242, 4);
    expect(result.scrapValueLE).toBeCloseTo(2070.1863, 3);
    expect(result.actualScrapPct).toBeCloseTo(0.429282608695652, 6);
  });
});

describe("calculateScrapPricingTotals", () => {
  it("uses sum-based totals, not an average of row percentages (matches Excel T19/T20)", () => {
    const inputs = [
      row({ usedWeightKg: 1966.896, buyWeightKg: 2826, usedAreaSqm: 31.32, buyAreaSqm: 0, buyQty: 5, usedLaterPct: 0.5 }),
      row({ usedWeightKg: 58.640128, buyWeightKg: 56.52, usedAreaSqm: 0.747008, buyAreaSqm: 0, buyQty: 3, usedLaterPct: 0.5 }),
    ];
    const rows = inputs.map(calculateScrapPricingRow);
    const totals = calculateScrapPricingTotals(rows);

    // Total-based, e.g. totalValueUsed / totalBuyCost — NOT average(actualScrapPct)
    const naiveAverage = rows.reduce((s, r) => s + r.actualScrapPct, 0) / rows.length;
    expect(totals.actualScrapPctFromBought).not.toBeCloseTo(naiveAverage, 3);

    expect(totals.totalUsedWeightKg).toBeCloseTo(1966.896 + 58.640128, 5);
    expect(totals.totalBuyWeightKg).toBeCloseTo(2826 + 56.52, 5);
    expect(totals.totalValueUsedLE).toBeCloseTo(rows[0].valueUsedLE + rows[1].valueUsedLE, 3);
    expect(totals.totalBuyCostLE).toBeCloseTo(rows[0].buyCostLE + rows[1].buyCostLE, 3);
    expect(totals.actualScrapPctFromBought).toBeCloseTo(1 - totals.totalValueUsedLE / totals.totalBuyCostLE, 8);
    expect(totals.actualScrapPctFromUsed).toBeCloseTo(totals.totalNetScrapAdjustmentLE / totals.totalCostUsedLE, 8);
  });
});
