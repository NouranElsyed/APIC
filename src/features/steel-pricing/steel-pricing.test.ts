/**
 * Parity test: every BOQ item must match the workbook's evaluated values.
 * Run: npm run test:steel-pricing
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcBoq } from "./steel-pricing-engine";
import { DEFAULT_ITEMS, DEFAULT_MATERIALS, DEFAULT_RATES } from "./steel-pricing-data";

type Fx = Record<string, { unit: number | null; total: number | null; cost: number | null; profit: number | null }>;
const fx: Fx = JSON.parse(readFileSync(join(__dirname, "__fixtures__/excel-fixtures.json"), "utf8"));
let failures = 0;
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 1e-9);
const check = (label: string, a: number, b: number) => {
  if (!close(a, b)) { failures++; console.error(`FAIL ${label}: app=${a} excel=${b}`); }
};

const boq = calcBoq(DEFAULT_ITEMS, DEFAULT_RATES, DEFAULT_MATERIALS);
let xlTotal = 0;
for (const item of DEFAULT_ITEMS) {
  const r = boq.items[item.no];
  const e = fx[item.no];
  xlTotal += e.total ?? 0;
  check(`${item.no} total`, r.finalPrice, e.total ?? 0);
  if (e.unit != null) check(`${item.no} unit`, r.unitPrice, e.unit);
  if (item.mode === "calc" && e.cost != null && r.mode === "calc") {
    check(`${item.no} cost`, r.totalCost, e.cost);
    check(`${item.no} profit`, r.profit, e.profit as number);
  }
}
check("BOQ grand total", boq.totals.grand, xlTotal);

// Propagation: editing S1.1's quantity price must flow to items priced like it (S3.1, S4.1, S11.01).
const bumped = calcBoq(DEFAULT_ITEMS, DEFAULT_RATES, { ...DEFAULT_MATERIALS, 14: { ...DEFAULT_MATERIALS[14], price: DEFAULT_MATERIALS[14].price * 1.1 } });
if (!(bumped.items["S3.1"].unitPrice > boq.items["S3.1"].unitPrice)) { failures++; console.error("FAIL: priced-like item S3.1 did not follow S1.1"); }
// Chain: I2.8 = I1.6 x 1.10
check("I2.8 = I1.6 x 1.1", boq.items["I2.8"].unitPrice, boq.items["I1.6"].unitPrice * 1.1);
// Per-item profile override changes the price.
const over = calcBoq(DEFAULT_ITEMS, DEFAULT_RATES, DEFAULT_MATERIALS, { "I3.6": { install: { manHour: "E" } } });
if (over.items["I3.6"].finalPrice === boq.items["I3.6"].finalPrice) { failures++; console.error("FAIL: profile override had no effect"); }

// Every input must move the price in the right direction.
const grand = (rates = DEFAULT_RATES, mats = DEFAULT_MATERIALS, ov = {}) => calcBoq(DEFAULT_ITEMS, rates, mats, ov).totals.grand;
const G0 = grand();
const expectUp = (label: string, v: number) => { if (!(v > G0)) { failures++; console.error(`FAIL ${label}: expected grand total to rise`); } };
// S1.1 prices off the ST-44 row (14) in the workbook; no BOQ item uses the ST-37 row (15) as its material.
expectUp("material price change (ST-44, used by S1.1)", grand(DEFAULT_RATES, { ...DEFAULT_MATERIALS, 14: { ...DEFAULT_MATERIALS[14], price: DEFAULT_MATERIALS[14].price * 1.2 } }));
expectUp("quantity change", grand(DEFAULT_RATES, DEFAULT_MATERIALS, { "S2.1": { qty: 1500 } }));
expectUp("fabrication (welding) rate change", grand({ ...DEFAULT_RATES, welding: { ...DEFAULT_RATES.welding, A: 20000 } }));
expectUp("installation rate change", grand({ ...DEFAULT_RATES, install: { ...DEFAULT_RATES.install, manHour: { ...DEFAULT_RATES.install.manHour, A: 4000 } } }));
expectUp("material switch (ST-52 heavy -> Handrail 55,000) on S2.1", grand(DEFAULT_RATES, DEFAULT_MATERIALS, { "S2.1": { matRow: 3 } }));
// Item kinds: fixed and unpriced never get an invented price; priced-like has no independent calc.
if (boq.items["S3.4"].mode !== "fixed" || boq.items["S3.4"].unitPrice !== 125000) { failures++; console.error("FAIL: S3.4 fixed price"); }
if (boq.items["S2.6"].mode !== "unpriced" || boq.items["S2.6"].finalPrice !== 0) { failures++; console.error("FAIL: S2.6 unpriced"); }
if (boq.items["S3.1"].mode !== "pricedLike") { failures++; console.error("FAIL: S3.1 should be priced-like"); }
// Reconciliation: final price = total cost + profit for every calculated item.
for (const item of DEFAULT_ITEMS) { const r = boq.items[item.no]; if (r.mode === "calc") check(`${item.no} cost+profit=final`, r.totalCost + r.profit, r.finalPrice); }

console.log(`${DEFAULT_ITEMS.length} items compared, grand total ${Math.round(boq.totals.grand).toLocaleString("en-US")} (Excel ${Math.round(xlTotal).toLocaleString("en-US")})`);
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("All parity checks passed.");
