import type {
  BoqItem, BoqResult, BoqTotals, CalcResult, CalcSpec, InstallLineResult, ItemOverride, ItemResult,
  MaterialTable, Overrides, Profile, ProfileRates, RateBook,
} from "./types";
import { INSTALL_KEYS } from "./types";

/**
 * Single source of truth for pricing. Formula order follows the workbook column by column:
 * Material (K–P) → Fabrication (Q–X) → Supply sale (Y) → Installation (AC–AP) → Additional (AR–AV)
 * → Tax (AX) → Insurance (AY) → Final (AZ) / Cost (BB) / Profit (BC).
 */
const rate = (r: ProfileRates, p: Profile | null | undefined): number => (p ? r[p] ?? 0 : 0);

export function applyOverride(item: BoqItem, ov?: ItemOverride): BoqItem {
  if (!ov) return item;
  const qty = ov.qty ?? item.qty;
  if (item.mode !== "calc") return { ...item, qty };
  const install = { ...item.spec.install };
  for (const [k, p] of Object.entries(ov.install ?? {})) {
    const line = install[k as keyof typeof install];
    if (line && p) install[k as keyof typeof install] = { ...line, p };
  }
  const matRow = ov.matRow === undefined ? item.spec.matRow : ov.matRow;
  return { ...item, qty, spec: { ...item.spec, matRow, install } };
}

export function materialPriceOf(spec: CalcSpec, qty: number, mats: MaterialTable): number {
  return spec.matRow ? qty * (mats[spec.matRow]?.price ?? 0) : 0;
}

export function calcItem(
  item: Extract<BoqItem, { mode: "calc" }>,
  R: RateBook,
  mats: MaterialTable,
  /** Resolves another item (for "charged on another item's material" links). */
  lookup?: (no: string) => BoqItem | undefined,
): CalcResult {
  const s = item.spec;
  const qty = Number(item.qty) || 0;
  const weight = qty;

  // 1. Material
  const materialRate = s.matRow ? mats[s.matRow]?.price ?? 0 : 0;
  const materialPrice = weight * materialRate;
  const handling = s.handling ? materialPrice * rate(R.handling, "A") : 0;
  let scrap = s.scrap ? materialPrice * rate(R.scrap, s.scrap) : 0;
  if (s.scrapLink) {
    const src = lookup?.(s.scrapLink.item);
    if (src && src.mode === "calc") scrap = materialPriceOf(src.spec, src.qty, mats) * rate(R.scrap, s.scrapLink.profile);
  }
  let accessories = s.accessories ? materialPrice * rate(R.accessories, s.accessories) : 0;
  if (s.accessoriesLink) {
    const src = lookup?.(s.accessoriesLink.item);
    if (src && src.mode === "calc") accessories = materialPriceOf(src.spec, src.qty, mats) * s.accessoriesLink.k;
  }
  const materialCost = materialPrice + handling + scrap + accessories;

  // 2. Fabrication
  const cutting = s.cutting ? weight * rate(R.cutting, s.cutting) : 0;
  const welding = s.welding ? weight * rate(R.welding, s.welding) : 0;
  const fabricationCost = cutting + welding; // rolling is 0 for every workbook item
  const ndt = s.ndt ? fabricationCost * rate(R.ndt, "A") : 0;
  const paintRate = s.paintingRate ?? (s.painting ? rate(R.painting, s.painting) : 0);
  const painting = weight * paintRate;
  const totalFabricationCost = materialCost + fabricationCost + ndt + painting;
  const fabIndirect = totalFabricationCost * rate(R.fabIndirect, s.fabIndirect);
  const supplySalePrice =
    materialCost * R.margins.material +
    fabricationCost * R.margins.fabrication +
    ndt * R.margins.ndt +
    painting * (s.paintingMargin ?? R.margins.painting);

  // 3. Installation
  const installLines: InstallLineResult[] = [];
  let installDirect = 0;
  for (const key of INSTALL_KEYS) {
    const line = s.install[key];
    if (!line) continue;
    const r = rate(R.install[key], line.p);
    const factor = line.k * (line.wt ? s.unitWt : 1);
    const amount = weight * r * factor;
    installLines.push({ key, profile: line.p, rate: r, factor, weight, amount });
    installDirect += amount;
  }
  const installIndirect = installDirect * rate(R.installIndirect, s.installIndirect);
  const installSale = (installDirect + installIndirect) * rate(R.installMargin, s.installMargin);
  const supplyAndInstall = supplySalePrice + installSale;

  // 4. Additional
  const mobDemob = s.mob ? supplyAndInstall * R.mobDemob : 0;
  const heightFactor = s.height ? supplyAndInstall * R.heightFactor : 0;
  const thirdParty = s.thirdParty ? supplyAndInstall * R.thirdParty : 0;
  const beforeCommissioning = supplyAndInstall + mobDemob + heightFactor + thirdParty;
  const commissioning = s.commissioning ? beforeCommissioning * R.commissioning : 0;
  const totalSale = beforeCommissioning + commissioning;

  // 5. Tax & insurance (workbook divides by a factor, e.g. 0.99 → +1.01%)
  const taxDiv = rate(R.tax, s.tax) || 1;
  const insDiv = rate(R.insurance, s.insurance) || 1;
  const afterTax = totalSale / taxDiv;
  const finalPrice = afterTax / insDiv;
  const tax = afterTax - totalSale;
  const insurance = finalPrice - afterTax;

  const totalCost =
    totalFabricationCost + fabIndirect + installDirect + installIndirect +
    mobDemob + heightFactor + thirdParty + (finalPrice - totalSale);
  const profit = finalPrice - totalCost;

  return {
    mode: "calc", qty, weight, matRow: s.matRow, materialRate, materialPrice, handling, scrap, accessories, materialCost,
    cutting, welding, fabricationCost, ndt, painting, totalFabricationCost, fabIndirect, supplySalePrice,
    installLines, installDirect, installIndirect, installSale, supplyAndInstall,
    mobDemob, heightFactor, thirdParty, beforeCommissioning, commissioning, totalSale,
    tax, insurance, finalPrice, unitPrice: weight > 0 ? finalPrice / weight : 0,
    totalCost, profit, profitPct: totalCost > 0 ? profit / totalCost : 0,
  };
}

/** Prices the whole BOQ, resolving "priced like" chains so source-item edits propagate. */
export function calcBoq(baseItems: BoqItem[], R: RateBook, mats: MaterialTable, overrides: Overrides = {}): BoqResult {
  const items = baseItems.map((i) => applyOverride(i, overrides[i.no]));
  const byNo = new Map(items.map((i) => [i.no, i]));
  const lookup = (no: string) => byNo.get(no);
  const memo = new Map<string, ItemResult>();
  const visiting = new Set<string>();

  const price = (item: BoqItem): ItemResult => {
    const hit = memo.get(item.no);
    if (hit) return hit;
    const qty = Number(item.qty) || 0;
    let res: ItemResult;
    if (item.mode === "calc") res = calcItem(item, R, mats, lookup);
    else if (item.mode === "fixed") res = { mode: "fixed", qty, unitPrice: item.fixed, finalPrice: qty * item.fixed, totalCost: null, profit: null, profitPct: null };
    else if (item.mode === "unpriced") res = { mode: "unpriced", qty, unitPrice: 0, finalPrice: 0, totalCost: null, profit: null, profitPct: null };
    else {
      const src = byNo.get(item.like.src);
      if (!src || visiting.has(item.no)) {
        res = { mode: "pricedLike", qty, src: item.like.src, mult: item.like.mult, srcUnitPrice: 0, unitPrice: 0, finalPrice: 0, totalCost: null, profit: null, profitPct: null };
      } else {
        visiting.add(item.no);
        const sr = price(src);
        visiting.delete(item.no);
        const unitPrice = sr.unitPrice * item.like.mult;
        const finalPrice = qty * unitPrice;
        // The workbook gives no cost for derived items; we scale the source's unit cost so
        // profit totals stay meaningful. Only when the source has a cost.
        const srcUnitCost = sr.totalCost != null && sr.qty > 0 ? sr.totalCost / sr.qty : null;
        const totalCost = srcUnitCost != null ? srcUnitCost * qty : null;
        const profit = totalCost != null ? finalPrice - totalCost : null;
        res = {
          mode: "pricedLike", qty, src: item.like.src, mult: item.like.mult, srcUnitPrice: sr.unitPrice, unitPrice, finalPrice,
          totalCost, profit, profitPct: totalCost ? (profit as number) / totalCost : null,
        };
      }
    }
    memo.set(item.no, res);
    return res;
  };

  const out: Record<string, ItemResult> = {};
  const t: BoqTotals = { supply: 0, install: 0, grand: 0, totalCost: 0, profit: 0, profitPct: 0, pricedItems: 0, costedItems: 0, additional: 0, taxInsurance: 0, weight: 0 };
  for (const item of items) {
    const r = price(item);
    out[item.no] = r;
    if (item.sec === "supply") t.supply += r.finalPrice; else t.install += r.finalPrice;
    t.grand += r.finalPrice;
    if (r.finalPrice > 0) t.pricedItems++;
    if (r.totalCost != null && r.profit != null) { t.totalCost += r.totalCost; t.profit += r.profit; t.costedItems++; }
    if (r.mode === "calc") {
      t.additional += r.mobDemob + r.heightFactor + r.thirdParty + r.commissioning;
      t.taxInsurance += r.tax + r.insurance;
      t.weight += r.weight;
    }
  }
  t.profitPct = t.totalCost > 0 ? t.profit / t.totalCost : 0;
  return { items: out, totals: t };
}

export function fmt(n: number): string {
  if (!isFinite(n)) n = 0;
  return Math.round(n).toLocaleString("en-US");
}
export function fmt2(n: number): string {
  if (!isFinite(n)) n = 0;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
export function pct(n: number | null, digits = 1): string {
  return n == null || !isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;
}
