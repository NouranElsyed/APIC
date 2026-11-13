// Pure quotation logic (no Prisma / React) so it can be unit-tested.

export type QStatus = "DRAFT" | "PENDING" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
export type QType = "SUPPLY" | "INSTALL";

export const STATUS_LABEL: Record<QStatus, string> = {
  DRAFT: "Draft", PENDING: "Pending", UNDER_REVIEW: "Under Review", APPROVED: "Approved", REJECTED: "Rejected",
};
export const TYPE_LABEL: Record<QType, string> = { SUPPLY: "Supply", INSTALL: "Dismantle & Install" };

export interface ItemMath { qty: number; unitRate: number; type: QType }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const lineTotal = (i: Pick<ItemMath, "qty" | "unitRate">) => r2(i.qty * i.unitRate);

export function totals(items: ItemMath[]): { supply: number; install: number; grand: number } {
  let supply = 0, install = 0;
  for (const i of items) {
    if (i.type === "INSTALL") install += lineTotal(i);
    else supply += lineTotal(i);
  }
  return { supply: r2(supply), install: r2(install), grand: r2(supply + install) };
}

/** Allowed status moves. Approved / rejected are final — change them by creating a revision. */
const NEXT: Record<QStatus, QStatus[]> = {
  DRAFT: ["PENDING", "UNDER_REVIEW"],
  PENDING: ["UNDER_REVIEW", "APPROVED", "REJECTED", "DRAFT"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "DRAFT"],
  APPROVED: [],
  REJECTED: [],
};
export const canTransition = (from: QStatus, to: QStatus) => NEXT[from].includes(to);
export const nextStatuses = (from: QStatus) => NEXT[from];
export const isEditable = (s: QStatus) => s !== "APPROVED" && s !== "REJECTED";
export const needsApprover = (to: QStatus) => to === "APPROVED" || to === "REJECTED";

export interface Summarizable { status: QStatus; total: number; issueDate: string }

export interface QuotationSummary {
  total: number;
  approved: number; pending: number; rejected: number; drafts: number;
  pctApproved: number; pctPending: number; pctRejected: number;
  approvedValue: number; totalValue: number;
}

/** "Pending" counts everything still waiting for a decision (submitted or under review). */
export function summarize(list: Summarizable[]): QuotationSummary {
  const n = list.length;
  const count = (f: (s: QStatus) => boolean) => list.filter((q) => f(q.status)).length;
  const approved = count((s) => s === "APPROVED");
  const pending = count((s) => s === "PENDING" || s === "UNDER_REVIEW");
  const rejected = count((s) => s === "REJECTED");
  const pct = (x: number) => (n ? Math.round((x / n) * 100) : 0);
  return {
    total: n, approved, pending, rejected, drafts: count((s) => s === "DRAFT"),
    pctApproved: pct(approved), pctPending: pct(pending), pctRejected: pct(rejected),
    approvedValue: r2(list.filter((q) => q.status === "APPROVED").reduce((s, q) => s + q.total, 0)),
    totalValue: r2(list.reduce((s, q) => s + q.total, 0)),
  };
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Total quoted value per month for the last `months` months ending with the month of `today`. */
export function monthlyTrend(list: Summarizable[], today: string, months = 6): { key: string; label: string; value: number }[] {
  const [ty, tm] = today.split("-").map(Number);
  const out: { key: string; label: string; value: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ty, tm - 1 - i, 1));
    out.push({ key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, label: MON[d.getUTCMonth()], value: 0 });
  }
  for (const q of list) {
    const slot = out.find((o) => q.issueDate.startsWith(o.key));
    if (slot) slot.value = r2(slot.value + q.total);
  }
  return out;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** "QTN-001-2026": sequence within the project + year of issue. */
export function quotationNumber(seq: number, year: number) {
  return `QTN-${String(seq).padStart(3, "0")}-${year}`;
}

export const money = (n: number, currency = "EGP") => `${currency} ${Math.round(n).toLocaleString("en-US")}`;
export const compactMoney = (n: number) => (n >= 1e6 ? `${(Math.round(n / 1e5) / 10).toString()}M` : n >= 1e3 ? `${Math.round(n / 100) / 10}K` : String(Math.round(n)));
