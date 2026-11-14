import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getMaterialUsage } from "@/server/services/material-usage.service";
import { PrintMaterialUsage } from "@/features/material-usage/print-material-usage";
import { buildUsage, DEFAULT_PRICES, DEFAULT_TARGET_PCT, parsePrice } from "@/features/material-usage/usage";

export default async function PrintMaterialUsagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "takeoff.view")) notFound();
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const prices = { costPerKg: parsePrice(one(sp.costPerKg), DEFAULT_PRICES.costPerKg), scrapPerKg: parsePrice(one(sp.scrapPerKg), DEFAULT_PRICES.scrapPerKg) };
  const targetPct = parsePrice(one(sp.target), DEFAULT_TARGET_PCT);
  const data = await getMaterialUsage(id, { planning: false });
  if (!data) notFound();
  const { rows, totals } = buildUsage(data.parts, prices);
  return <PrintMaterialUsage title={`${data.project.number} — ${data.project.name}`} currency={data.currency} prices={prices} targetPct={targetPct} rows={rows} totals={totals} />;
}
