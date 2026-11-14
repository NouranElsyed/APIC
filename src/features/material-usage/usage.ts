// Pure maths for a project's Material & Usage tab (no Prisma / React) so it can be unit-tested.
//
// Source: the project's Standard Calculations (takeoff parts).
//   used     = weightKg      (net weight of the finished parts)
//   purchase = buyWeightKg   (stock bought for the row; when it was not entered we assume no scrap, i.e. purchase = used)
//   scrap    = buyWeightKg - weightKg
// Prices are inputs (EGP per kg), because the system does not store material prices per project.

export type UsagePartType = "PLATE" | "HOT_ROLLED" | "CONE" | "PIPE";

export interface UsagePart {
  partType: UsagePartType;
  material: string | null;
  thicknessMm: number | null;
  weightKg: number;
  buyWeightKg: number | null;
  scrapKg: number | null;
}

export interface Prices {
  /** purchase price of the steel, per kg */
  costPerKg: number;
  /** what the scrap sells for, per kg */
  scrapPerKg: number;
}

export interface UsageRow {
  key: string;
  name: string;
  standard: string;
  usedKg: number;
  purchaseKg: number;
  scrapKg: number;
  usedCost: number;
  purchaseCost: number;
  scrapValue: number;
  /** scrap ÷ purchase weight, % */
  scrapPct: number;
  /** money lost on scrap after reselling it, as % of the purchase cost */
  lossPct: number;
  parts: number;
  /** parts that have a purchase weight entered */
  trackedParts: number;
}

export interface UsageTotals extends Omit<UsageRow, "key" | "name" | "standard"> {}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
const thk = (t: number | null) => (t == null ? "" : ` ${Number.isInteger(t) ? t : Math.round(t * 100) / 100} mm`);

export function groupName(p: Pick<UsagePart, "partType" | "thicknessMm">): string {
  switch (p.partType) {
    case "PLATE": return `Steel Plates${thk(p.thicknessMm)}`;
    case "CONE": return `Cones${thk(p.thicknessMm)}`;
    case "PIPE": return `Pipes${thk(p.thicknessMm)}`;
    default: return "Steel Sections";
  }
}

const groupKey = (p: UsagePart) => `${groupName(p)}|${(p.material ?? "").trim().toUpperCase()}`;

function finish(base: { usedKg: number; purchaseKg: number; scrapKg: number; parts: number; trackedParts: number }, prices: Prices) {
  const usedCost = r2(base.usedKg * prices.costPerKg);
  const purchaseCost = r2(base.purchaseKg * prices.costPerKg);
  const scrapValue = r2(base.scrapKg * prices.scrapPerKg);
  const lostMoney = base.scrapKg * (prices.costPerKg - prices.scrapPerKg);
  return {
    ...base,
    usedKg: r2(base.usedKg), purchaseKg: r2(base.purchaseKg), scrapKg: r2(base.scrapKg),
    usedCost, purchaseCost, scrapValue,
    scrapPct: base.purchaseKg > 0 ? r2((base.scrapKg / base.purchaseKg) * 100) : 0,
    lossPct: purchaseCost > 0 ? r2((lostMoney / (base.purchaseKg * prices.costPerKg)) * 100) : 0,
  };
}

export function buildUsage(parts: UsagePart[], prices: Prices): { rows: UsageRow[]; totals: UsageTotals } {
  const map = new Map<string, { name: string; standard: string; usedKg: number; purchaseKg: number; scrapKg: number; parts: number; trackedParts: number }>();
  const all = { usedKg: 0, purchaseKg: 0, scrapKg: 0, parts: 0, trackedParts: 0 };

  for (const p of parts) {
    const used = Math.max(0, num(p.weightKg));
    const tracked = p.buyWeightKg != null && Number.isFinite(p.buyWeightKg);
    const purchase = tracked ? Math.max(used, num(p.buyWeightKg)) : used;
    const scrap = tracked ? Math.max(0, p.scrapKg != null ? num(p.scrapKg) : purchase - used) : 0;
    const k = groupKey(p);
    const g = map.get(k) ?? { name: groupName(p), standard: (p.material ?? "").trim() || "—", usedKg: 0, purchaseKg: 0, scrapKg: 0, parts: 0, trackedParts: 0 };
    g.usedKg += used; g.purchaseKg += purchase; g.scrapKg += scrap; g.parts++; if (tracked) g.trackedParts++;
    map.set(k, g);
    all.usedKg += used; all.purchaseKg += purchase; all.scrapKg += scrap; all.parts++; if (tracked) all.trackedParts++;
  }

  const rows = [...map.entries()]
    .map(([key, g]) => ({ key, name: g.name, standard: g.standard, ...finish(g, prices) }))
    .sort((a, b) => b.usedKg - a.usedKg || a.name.localeCompare(b.name));
  return { rows, totals: finish(all, prices) };
}

/** Largest `n` rows by used weight, the rest folded into "Others" (tons). */
export function topUsage(rows: UsageRow[], n = 5): { name: string; tons: number }[] {
  const top = rows.slice(0, n).map((r) => ({ name: r.name, tons: r2(r.usedKg / 1000) }));
  const rest = rows.slice(n).reduce((s, r) => s + r.usedKg, 0);
  return rest > 0 ? [...top, { name: "Others", tons: r2(rest / 1000) }] : top;
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Cumulative purchase-order value by month (orders without a price are skipped). */
export function cumulativeOrders(orders: { date: string | null; value: number | null }[]): { key: string; label: string; value: number }[] {
  const byMonth = new Map<string, number>();
  for (const o of orders) {
    if (!o.date || o.value == null || !Number.isFinite(o.value)) continue;
    const key = o.date.slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + o.value);
  }
  const keys = [...byMonth.keys()].sort();
  const multiYear = new Set(keys.map((k) => k.slice(0, 4))).size > 1;
  let run = 0;
  return keys.map((key) => {
    run += byMonth.get(key)!;
    const [y, m] = key.split("-").map(Number);
    return { key, label: `${MON[m - 1]}${multiYear ? ` ${String(y).slice(2)}` : ""}`, value: r2(run) };
  });
}

/** Safe number from a query-string / form value. */
export function parsePrice(v: unknown, fallback: number): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const DEFAULT_PRICES: Prices = { costPerKg: 46, scrapPerKg: 15 };
export const DEFAULT_TARGET_PCT = 6;
