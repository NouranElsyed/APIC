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
// Painting per m²: with a per-m² price and a painted area, painting = area x price; default stays per ton.
{
  const R2 = { ...DEFAULT_RATES, paintingArea: { A: 100, B: 100, C: 100, D: 100, E: 100 } };
  const asArea = calcBoq(DEFAULT_ITEMS, R2, DEFAULT_MATERIALS, { "S1.1": { paintBasis: "area", paintArea: 2000 } }).items["S1.1"];
  const asTon = boq.items["S1.1"];
  if (asArea.mode !== "calc" || asTon.mode !== "calc") { failures++; console.error("FAIL: S1.1 should be calculated"); }
  else {
    check("S1.1 painting per m2 = 2000 x 100", asArea.painting, 200000);
    check("S1.1 painting per ton = default (25 t x 12,500)", asTon.painting, 312500);
    if (asArea.finalPrice === asTon.finalPrice) { failures++; console.error("FAIL: painting basis had no effect"); }
  }
}
// Reconciliation: final price = total cost + profit for every calculated item.
for (const item of DEFAULT_ITEMS) { const r = boq.items[item.no]; if (r.mode === "calc") check(`${item.no} cost+profit=final`, r.totalCost + r.profit, r.finalPrice); }

// Per-item checkboxes: unticking a component removes its cost; ticking one the workbook leaves out adds it.
{
  const base = boq.items["S1.1"];
  const run = (ov: object) => calcBoq(DEFAULT_ITEMS, DEFAULT_RATES, DEFAULT_MATERIALS, { "S1.1": ov }).items["S1.1"];
  if (base.mode !== "calc") { failures++; console.error("FAIL: S1.1 should be a calculated item"); }
  else {
    const noTransport = run({ toggles: { "install.transport": false } });
    const noNdt = run({ toggles: { ndt: false, handling: false } });
    const crane = run({ toggles: { "install.crane": true } });
    if (noTransport.mode !== "calc" || noNdt.mode !== "calc" || crane.mode !== "calc") { failures++; console.error("FAIL: toggled S1.1 should stay calculated"); }
    else {
      check("S1.1 transport off -> no transport line", noTransport.installLines.some((l) => l.key === "transport") ? 1 : 0, 0);
      check("S1.1 transport off lowers install cost", noTransport.installDirect, base.installDirect - 25 * 1000);
      check("S1.1 ndt off", noNdt.ndt, 0);
      check("S1.1 handling off", noNdt.handling, 0);
      check("S1.1 crane on adds 25 t x 2,800 (profile A)", crane.installDirect, base.installDirect + 25 * 2800);
    }
  }
  // Ticking a component back to the default state must reproduce the workbook price exactly.
  const same = run({ toggles: { ndt: true, "install.transport": true } });
  check("S1.1 toggles equal to defaults = workbook price", same.finalPrice, base.finalPrice);
}

// User-added lines ("Hot rolled" etc.): per-unit and lump-sum, unchecked lines cost nothing, each group picks up its margin.
{
  const base = boq.items["S1.1"];
  const line = (id: string, group: "material" | "fabrication" | "installation", basis: "perUnit" | "fixed", rate: number, enabled = true) => ({ id, label: id, group, basis, rate, enabled });
  const run = (custom: ReturnType<typeof line>[]) => calcBoq(DEFAULT_ITEMS, DEFAULT_RATES, DEFAULT_MATERIALS, { "S1.1": { custom } }).items["S1.1"];
  const r1 = run([line("hot", "material", "perUnit", 2000)]);
  const r2 = run([line("hot", "material", "perUnit", 2000, false)]);
  const r3 = run([line("fab", "fabrication", "fixed", 10000), line("inst", "installation", "perUnit", 100)]);
  if (base.mode !== "calc" || r1.mode !== "calc" || r2.mode !== "calc" || r3.mode !== "calc") { failures++; console.error("FAIL: custom-line items should stay calculated"); }
  else {
    check("hot rolled 2,000 x 25 t added to material cost", r1.materialCost, base.materialCost + 50000);
    check("material line carries the material margin (x1.1)", r1.supplySalePrice, base.supplySalePrice + 50000 * DEFAULT_RATES.margins.material);
    check("unchecked custom line = workbook price", r2.finalPrice, base.finalPrice);
    check("fixed fabrication line", r3.customFabrication, 10000);
    check("per-unit installation line 100 x 25 t", r3.customInstall, 2500);
    check("installation line raises install direct", r3.installDirect, base.installDirect + 2500);
    check("custom lines keep cost + profit = final", r3.totalCost + r3.profit, r3.finalPrice);
  }
}

// Workbook columns that are 0 for every item: Inflation, Rolling, Subcontractor. Off by default; ticking them charges the rate.
{
  const base = boq.items["S1.1"];
  const rates = { ...DEFAULT_RATES, inflation: { A: 0.02 }, rolling: { A: 500 }, subcontract: { A: 100 } };
  const run = (toggles: Record<string, boolean>) => calcBoq(DEFAULT_ITEMS, rates, DEFAULT_MATERIALS, { "S1.1": { toggles } }).items["S1.1"];
  const off = calcBoq(DEFAULT_ITEMS, rates, DEFAULT_MATERIALS).items["S1.1"];
  check("non-zero inflation/rolling/subcontract rates change nothing until ticked", off.finalPrice, base.finalPrice);
  const all = run({ inflation: true, rolling: true, subcontract: true });
  if (base.mode !== "calc" || all.mode !== "calc") { failures++; console.error("FAIL: S1.1 should be calculated"); }
  else {
    check("inflation = 2% of material price", all.inflation, base.materialPrice * 0.02);
    check("rolling = 25 t x 500", all.rolling, 12500);
    check("subcontract cost = 25 x 100", all.subcontract, 2500);
    check("subcontract sale = cost x 1.2", all.subcontractSale, 3000);
    check("subcontract sale joins supply + installation", all.supplyAndInstall, base.supplyAndInstall + 3000 + all.supplySalePrice - base.supplySalePrice);
    check("cost + profit = final with the new components", all.totalCost + all.profit, all.finalPrice);
  }
}

// Rate options: pick a price per component; add your own named price and reuse it on other items.
{
  const withOpt = structuredClone(DEFAULT_RATES);
  withOpt.install.transport.xsup = 1500; // "Supplier X" transport price added by the user
  withOpt.scrap.xsup = 0.1;
  withOpt.rateLabels.xsup = "Supplier X";
  const run = (rates: typeof withOpt, no: string, ov: object) => calcBoq(DEFAULT_ITEMS, rates, DEFAULT_MATERIALS, { [no]: ov }).items[no];
  const s11 = boq.items["S1.1"];
  const a = run(withOpt, "S1.1", { install: { transport: "xsup" }, rates: { scrap: "xsup" } });
  if (s11.mode !== "calc" || a.mode !== "calc") { failures++; console.error("FAIL: S1.1 should be calculated"); }
  else {
    const tr = a.installLines.find((l) => l.key === "transport");
    check("custom transport price used (25 t x 1,500)", tr?.amount ?? -1, 25 * 1500);
    check("custom scrap % used (10% of material price)", a.scrap, s11.materialPrice * 0.1);
    // Same price reused on another item (S1.2 has transport too).
    const b = run(withOpt, "S1.2", { install: { transport: "xsup" } });
    const b0 = boq.items["S1.2"];
    if (b.mode === "calc" && b0.mode === "calc") check("custom price reusable on another item", (b.installLines.find((l) => l.key === "transport")?.rate ?? -1), 1500);
    // Editing the shared price changes every item that uses it.
    const edited = structuredClone(withOpt); edited.install.transport.xsup = 2000;
    const c = run(edited, "S1.1", { install: { transport: "xsup" } });
    if (c.mode === "calc") check("editing the price updates the item", c.installLines.find((l) => l.key === "transport")?.amount ?? -1, 25 * 2000);
    // Deleted price falls back to profile A instead of 0.
    const del = structuredClone(withOpt); delete del.install.transport.xsup;
    const d = run(del, "S1.1", { install: { transport: "xsup" } });
    if (d.mode === "calc") check("deleted price falls back to profile A", d.installLines.find((l) => l.key === "transport")?.amount ?? -1, 25 * 1000);
  }
}

console.log(`${DEFAULT_ITEMS.length} items compared, grand total ${Math.round(boq.totals.grand).toLocaleString("en-US")} (Excel ${Math.round(xlTotal).toLocaleString("en-US")})`);
if (failures) { console.error(`${failures} failure(s)`); process.exit(1); }
console.log("All parity checks passed.");
