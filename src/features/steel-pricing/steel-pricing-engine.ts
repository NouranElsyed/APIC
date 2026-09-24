import type {
  BoqItem, BoqResult, BoqTotals, CalcResult, CalcSpec, CustomGroup, CustomLineResult, InstallKey, InstallLineResult, ItemOverride, ItemResult,
  MaterialTable, Overrides, Profile, ProfileRates, RateBook,
} from "./types";
import { INSTALL_KEYS, PROFILES } from "./types";

/**
 * Single source of truth for pricing. Formula order follows the workbook column by column:
 * Material (K–P) → Fabrication (Q–X) → Supply sale (Y) → Installation (AC–AP) → Additional (AR–AV)
 * → Tax (AX) → Insurance (AY) → Final (AZ) / Cost (BB) / Profit (BC).
 */
const BUILTIN = new Set<string>(PROFILES);
/**
 * Rate of one option. A built-in profile without a value is charged as 0 (as in the workbook);
 * a user-added option that no longer exists (deleted) falls back to profile A instead of silently costing 0.
 */
const rate = (r: ProfileRates, p: Profile | null | undefined): number => {
  if (!p) return 0;
  const v = r[p];
  if (v !== undefined) return v;
  return BUILTIN.has(p) ? 0 : r.A ?? 0;
};
export const rateValue = rate;

/** The rate option a component currently uses (null when it has no per-component choice). */
export function profileOf(s: CalcSpec, id: string): Profile | "item" | null {
  switch (id) {
    case "handling": case "ndt": case "inflation": case "rolling": case "subcontract": return s.rateSel?.[id] ?? "A";
    case "scrap": return s.scrapLink?.profile ?? s.scrap ?? "A";
    case "accessories": return s.accessoriesLink ? null : s.accessories ?? "A";
    case "cutting": return s.cutting ?? "A";
    case "welding": return s.welding ?? "A";
    case "fabIndirect": return s.fabIndirect ?? "A";
    case "painting": return s.paintingRate ? "item" : s.painting ?? "A";
    default: return id.startsWith("install.") ? s.install[id.slice(8) as InstallKey]?.p ?? "A" : null;
  }
}

/** Is this checkbox component currently included in the item's price? */
export function componentOn(s: CalcSpec, id: string): boolean {
  switch (id) {
    case "handling": return s.handling;
    case "scrap": return !!(s.scrap || s.scrapLink);
    case "accessories": return !!(s.accessories || s.accessoriesLink);
    case "cutting": return !!s.cutting;
    case "welding": return !!s.welding;
    case "inflation": return !!s.inflation;
    case "rolling": return !!s.rolling;
    case "subcontract": return !!s.subcontract;
    case "painting": return !!(s.painting || s.paintingRate);
    case "ndt": return s.ndt;
    case "fabIndirect": return !!s.fabIndirect;
    case "mob": return s.mob;
    case "height": return s.height;
    case "thirdParty": return s.thirdParty;
    case "commissioning": return s.commissioning;
    default: return id.startsWith("install.") ? !!s.install[id.slice(8) as InstallKey] : false;
  }
}

/** Switches one component on/off on a (cloned) spec. Newly enabled components start on rate profile A. */
function applyToggle(s: CalcSpec, id: string, on: boolean) {
  if (componentOn(s, id) === on) return;
  switch (id) {
    case "handling": s.handling = on; break;
    case "scrap": if (on) s.scrap = "A"; else { s.scrap = null; delete s.scrapLink; } break;
    case "accessories": if (on) s.accessories = "A"; else { s.accessories = null; delete s.accessoriesLink; } break;
    case "cutting": s.cutting = on ? "A" : null; break;
    case "welding": s.welding = on ? "A" : null; break;
    case "fabIndirect": s.fabIndirect = on ? "A" : null; break;
    case "painting": if (on) s.painting = "A"; else { s.painting = null; delete s.paintingRate; } break;
    case "inflation": s.inflation = on; break;
    case "rolling": s.rolling = on; break;
    case "subcontract": s.subcontract = on; break;
    case "ndt": s.ndt = on; break;
    case "mob": s.mob = on; break;
    case "height": s.height = on; break;
    case "thirdParty": s.thirdParty = on; break;
    case "commissioning": s.commissioning = on; break;
    default:
      if (id.startsWith("install.")) {
        const k = id.slice(8) as InstallKey;
        if (on) s.install[k] = { p: "A", k: 1, wt: s.unitWt > 0 };
        else delete s.install[k];
      }
  }
}

export function applyOverride(item: BoqItem, ov?: ItemOverride): BoqItem {
  if (!ov) return item;
  const qty = ov.qty ?? item.qty;
  if (item.mode !== "calc") return { ...item, qty };
  const spec: CalcSpec = { ...item.spec, install: { ...item.spec.install } };
  for (const [id, on] of Object.entries(ov.toggles ?? {})) applyToggle(spec, id, on);
  for (const [k, p] of Object.entries(ov.install ?? {})) {
    const line = spec.install[k as keyof typeof spec.install];
    if (line && p) spec.install[k as keyof typeof spec.install] = { ...line, p };
  }
  for (const [id, p] of Object.entries(ov.rates ?? {})) {
    switch (id) {
      case "scrap": if (spec.scrapLink) spec.scrapLink = { ...spec.scrapLink, profile: p }; else if (spec.scrap) spec.scrap = p; break;
      case "accessories": if (spec.accessories) spec.accessories = p; break;
      case "cutting": if (spec.cutting) spec.cutting = p; break;
      case "welding": if (spec.welding) spec.welding = p; break;
      case "fabIndirect": if (spec.fabIndirect) spec.fabIndirect = p; break;
      case "painting": if (spec.painting || spec.paintingRate) { spec.painting = p; delete spec.paintingRate; } break;
      case "handling": case "ndt": case "inflation": case "rolling": case "subcontract": spec.rateSel = { ...spec.rateSel, [id]: p }; break;
    }
  }
  spec.matRow = ov.matRow === undefined ? item.spec.matRow : ov.matRow;
  spec.paintBasis = ov.paintBasis ?? item.spec.paintBasis;
  spec.paintArea = ov.paintArea ?? item.spec.paintArea;
  if (ov.custom?.length) spec.custom = ov.custom;
  return { ...item, qty, spec };
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
  const pf = (id: string): Profile => s.rateSel?.[id] ?? "A";
  const handling = s.handling ? materialPrice * rate(R.handling, pf("handling")) : 0;
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

  // User-added lines. "perUnit" multiplies by the item quantity, "fixed" is a lump sum; unchecked lines cost nothing.
  const customLines: CustomLineResult[] = (s.custom ?? []).map((c) => ({
    ...c, amount: !c.enabled ? 0 : c.basis === "perUnit" ? weight * c.rate : c.rate,
  }));
  const customSum = (g: CustomGroup) => customLines.reduce((a, c) => (c.group === g ? a + c.amount : a), 0);
  const customMaterial = customSum("material");
  const customFabrication = customSum("fabrication");
  const customInstall = customSum("installation");
  const inflation = s.inflation ? materialPrice * rate(R.inflation, pf("inflation")) : 0;
  const materialCost = materialPrice + handling + scrap + accessories + inflation + customMaterial;

  // 2. Fabrication
  const cutting = s.cutting ? weight * rate(R.cutting, s.cutting) : 0;
  const welding = s.welding ? weight * rate(R.welding, s.welding) : 0;
  const rolling = s.rolling ? weight * rate(R.rolling, pf("rolling")) : 0; // 0 for every workbook item unless ticked
  const fabricationCost = cutting + welding + rolling + customFabrication;
  const ndt = s.ndt ? fabricationCost * rate(R.ndt, pf("ndt")) : 0;
  // Painting: per ton of steel (workbook) or, when the painted area is known, per m².
  const paintBasis = s.paintBasis ?? "ton";
  const paintArea = Number(s.paintArea) || 0;
  const paintRate =
    paintBasis === "area"
      ? (s.painting ? rate(R.paintingArea, s.painting) : 0)
      : s.paintingRate ?? (s.painting ? rate(R.painting, s.painting) : 0);
  const painting = (paintBasis === "area" ? paintArea : weight) * paintRate;
  const totalFabricationCost = materialCost + fabricationCost + ndt + painting;
  const fabIndirect = totalFabricationCost * rate(R.fabIndirect, s.fabIndirect);
  const supplySalePrice =
    materialCost * R.margins.material +
    fabricationCost * R.margins.fabrication +
    ndt * R.margins.ndt +
    painting * (s.paintingMargin ?? R.margins.painting);

  // Subcontractor: cost per unit × quantity, sold at cost × subcontract margin, added to supply + installation.
  const subcontract = s.subcontract ? weight * rate(R.subcontract, pf("subcontract")) : 0;
  const subcontractSale = subcontract * R.subcontractMargin;

  // 3. Installation
  const installLines: InstallLineResult[] = [];
  let installDirect = customInstall;
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
  const supplyAndInstall = supplySalePrice + subcontractSale + installSale;

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
    totalFabricationCost + fabIndirect + subcontract + installDirect + installIndirect +
    mobDemob + heightFactor + thirdParty + (finalPrice - totalSale);
  const profit = finalPrice - totalCost;

  return {
    mode: "calc", qty, weight, matRow: s.matRow, materialRate, materialPrice, handling, scrap, accessories, inflation, customMaterial, materialCost,
    cutting, welding, rolling, customFabrication, fabricationCost, ndt, painting, paintBasis, paintArea, paintRate, totalFabricationCost, fabIndirect, supplySalePrice, subcontract, subcontractSale,
    installLines, customInstall, customLines, installDirect, installIndirect, installSale, supplyAndInstall,
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
