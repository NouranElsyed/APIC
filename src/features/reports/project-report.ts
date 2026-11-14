// Pure helpers for the per-project Reports tab (no Prisma / React) so they can be unit-tested.

import { dayToIso } from "@/features/planning/calendar";
import type { Kpis, SCurve } from "@/features/planning/metrics";
import type { QuotationRowDTO } from "@/features/quotations/dto";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const round = (n: number, p = 100) => Math.round(n * p) / p;

// ------------------------------------------------------------------ schedule status

export type StatusTone = "good" | "warn" | "bad" | "muted";
export interface ScheduleStatus { label: "On Track" | "At Risk" | "Delayed" | "No schedule"; tone: StatusTone }

/** Delay against the baseline wins; otherwise the schedule performance index decides. */
export function scheduleStatus(k: Pick<Kpis, "delayDays" | "spi" | "hasBaseline"> | null): ScheduleStatus {
  if (!k) return { label: "No schedule", tone: "muted" };
  if (k.hasBaseline && k.delayDays > 0) return { label: "Delayed", tone: "bad" };
  if (k.spi != null && k.spi < 0.9) return { label: "Delayed", tone: "bad" };
  if (k.spi != null && k.spi < 0.97) return { label: "At Risk", tone: "warn" };
  return { label: "On Track", tone: "good" };
}

/** "+7 Days" / "-3 Days" / "On time" for the KPI card. */
export function delayText(k: Pick<Kpis, "delayDays" | "hasBaseline"> | null): { value: string; note: string; tone: StatusTone } {
  if (!k) return { value: "—", note: "No schedule yet", tone: "muted" };
  if (!k.hasBaseline) return { value: "—", note: "Set a baseline to track delay", tone: "muted" };
  if (k.delayDays > 0) return { value: `+${k.delayDays} Days`, note: "Behind Schedule", tone: "bad" };
  if (k.delayDays < 0) return { value: `${k.delayDays} Days`, note: "Ahead of Schedule", tone: "good" };
  return { value: "On time", note: "On Schedule", tone: "good" };
}

// ------------------------------------------------------------------ SPI by month

export interface SpiPoint { label: string; day: number; planned: number; actual: number; spi: number }

function actualAt(actual: SCurve["actual"], day: number): number {
  if (actual.length === 0) return 0;
  if (day <= actual[0].day) return actual[0].value;
  const last = actual[actual.length - 1];
  if (day >= last.day) return last.value;
  for (let i = 1; i < actual.length; i++) {
    const a = actual[i - 1], b = actual[i];
    if (day <= b.day) return b.day === a.day ? b.value : a.value + ((b.value - a.value) * (day - a.day)) / (b.day - a.day);
  }
  return last.value;
}

/**
 * Schedule performance index (actual % ÷ planned %) at each point of the S-curve that is already
 * in the past, the last `limit` of them. Planned follows the baseline when there is one.
 */
export function monthlySpi(s: SCurve, hasBaseline: boolean, limit = 6): SpiPoint[] {
  if (s.points.length < 2) return [];
  const first = s.points[0].day;
  const last = s.points[s.points.length - 1].day;
  const weekly = last - first <= 120;
  const out: SpiPoint[] = [];
  for (const p of s.points) {
    if (p.day > s.dataDay) continue;
    const iso = dayToIso(p.day);
    const [, m, d] = iso.split("-").map(Number);
    if (!weekly && d !== 1) continue; // month starts only (skips start/finish/data-date helper points)
    if (weekly && p.day === first - 1) continue;
    const planned = hasBaseline && p.baseline != null ? p.baseline : p.plan;
    if (planned <= 0.5) continue;
    const actual = actualAt(s.actual, p.day);
    out.push({ label: weekly ? `${d} ${MONTHS[m - 1]}` : MONTHS[m - 1], day: p.day, planned: round(planned, 10), actual: round(actual, 10), spi: round(actual / planned) });
  }
  return out.slice(-limit);
}

// ------------------------------------------------------------------ cost

export interface CostBreakdown {
  basis: "approved" | "quoted" | "none";
  currency: string;
  total: number;
  supply: number;
  install: number;
  quotations: number;
}

/**
 * The project budget comes from its quotations (latest revision of each): approved ones when there
 * are any, otherwise everything not rejected, flagged as "quoted" so the UI can say it is an estimate.
 */
export function costBreakdown(rows: Pick<QuotationRowDTO, "status" | "currency" | "total" | "supply" | "install">[]): CostBreakdown {
  const approved = rows.filter((r) => r.status === "APPROVED");
  const quoted = rows.filter((r) => r.status !== "REJECTED");
  const used = approved.length ? approved : quoted;
  const basis = approved.length ? "approved" : quoted.length ? "quoted" : "none";
  const sum = (f: (r: (typeof rows)[number]) => number) => round(used.reduce((s, r) => s + f(r), 0));
  return { basis, currency: used[0]?.currency ?? "EGP", total: sum((r) => r.total), supply: sum((r) => r.supply), install: sum((r) => r.install), quotations: used.length };
}

/** Earned value = budget × physical progress. */
export const earnedValue = (budget: number, progressPercent: number) => round((budget * Math.min(100, Math.max(0, progressPercent))) / 100);
