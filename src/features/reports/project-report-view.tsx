"use client";
import * as React from "react";
import Link from "next/link";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BadgeCheck, CalendarDays, ChevronRight, Coins, Download, FileSpreadsheet, FileText, Gauge, ListChecks, PieChart as PieIcon, TrendingUp, Waypoints, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChartLegend, SCurveChart } from "@/features/planning/charts";
import { fmtLong, } from "@/features/planning/gantt-chart";
import { ProjectStrip } from "./project-strip";
import { delayText, scheduleStatus, type StatusTone } from "./project-report";
import type { ProjectReportData } from "@/server/services/project-reports.service";

const TONE_TEXT: Record<StatusTone, string> = { good: "text-green-600", warn: "text-amber-600", bad: "text-red-600", muted: "text-muted-foreground" };
const BLUE = "#1d4ed8", GREEN = "#16a34a", AMBER = "#f59e0b", GREY = "#e2e8f0";

const money = (n: number) => Math.round(n).toLocaleString("en-US");
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.?0+$/, "")}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K` : money(n));

export function ProjectReportView({ data, tabs, canCost, canEditPlan }: { data: ProjectReportData; tabs: React.ReactNode; canCost: boolean; canEditPlan: boolean }) {
  const { project: p, schedule, cost, materials } = data;
  const k = schedule?.kpis ?? null;
  const status = scheduleStatus(k);
  const delay = delayText(k);
  const progress = Math.round(k?.progress ?? 0);
  const id = p.id;
  const hasCost = !!cost && cost.basis !== "none";

  return (
    <div className="space-y-5">
      <ProjectStrip name={p.name} number={p.number} startDate={p.startDate} endDate={p.endDate} status={status} />

      {tabs}

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<Gauge className="h-5 w-5 text-primary" />} tint="bg-primary/10" label="Project Progress" value={schedule ? `${progress}%` : "—"}>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} /></div>
        </Kpi>
        <Kpi icon={<CalendarDays className={cn("h-5 w-5", TONE_TEXT[delay.tone])} />} tint={delay.tone === "bad" ? "bg-red-500/10" : "bg-green-500/10"} label="Schedule Status" value={delay.value} valueClass={TONE_TEXT[delay.tone]}>
          <p className="mt-1 text-xs text-muted-foreground">{delay.note}</p>
        </Kpi>
        {canCost && (
          <>
            <Kpi icon={<Coins className="h-5 w-5 text-violet-600" />} tint="bg-violet-500/10" label={`Total Cost (${cost?.currency ?? "EGP"})`} value={hasCost ? money(cost!.total) : "—"}>
              <p className="mt-1 text-xs text-muted-foreground">{!cost || cost.basis === "none" ? "No quotation yet" : cost.basis === "approved" ? `${cost.quotations} approved quotation${cost.quotations > 1 ? "s" : ""}` : "Estimate — nothing approved yet"}</p>
            </Kpi>
            <Kpi icon={<BadgeCheck className="h-5 w-5 text-green-600" />} tint="bg-green-500/10" label={`Earned Value (${cost?.currency ?? "EGP"})`} value={cost?.earnedValue != null ? money(cost.earnedValue) : "—"}>
              <p className="mt-1 text-xs text-muted-foreground">{cost?.earnedValue != null ? `${progress}% of Budget` : "Needs a schedule and a quotation"}</p>
            </Kpi>
          </>
        )}
        {!canCost && materials && (
          <Kpi icon={<ListChecks className="h-5 w-5 text-amber-600" />} tint="bg-amber-500/10" label="Materials Delivered" value={`${Math.round(materials.percentDelivered)}%`}>
            <p className="mt-1 text-xs text-muted-foreground">{materials.items} items tracked</p>
          </Kpi>
        )}
      </div>

      {/* charts */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr_1fr]">
        <Panel icon={<PieIcon className="h-4 w-4 text-primary" />} title="Project Progress" action={<Link href={`/projects/${id}/planning`} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">View Details <ChevronRight className="h-3.5 w-3.5" /></Link>}>
          {schedule ? (
            <div className="flex items-center gap-4">
              <Donut data={[{ name: "Completed", value: progress, color: BLUE }, { name: "Remaining", value: 100 - progress, color: GREY }]} center={<><p className="text-2xl font-bold">{progress}%</p><p className="text-xs text-muted-foreground">Complete</p></>} />
              <Legend items={[{ label: "Completed", value: `${progress}%`, color: BLUE }, { label: "Remaining", value: `${100 - progress}%`, color: GREY }]} />
            </div>
          ) : <NoSchedule id={id} canEdit={canEditPlan} />}
        </Panel>

        <Panel icon={<TrendingUp className="h-4 w-4 text-primary" />} title="Schedule Performance (S-Curve)" action={schedule ? <ChartLegend hasBaseline={!!k?.hasBaseline} /> : undefined}>
          {schedule ? <SCurveChart data={schedule.scurve} hasBaseline={!!k?.hasBaseline} height={240} /> : <NoSchedule id={id} canEdit={canEditPlan} />}
        </Panel>

        {canCost && (
          <Panel icon={<Coins className="h-4 w-4 text-primary" />} title="Cost Summary">
            {hasCost ? (
              <div className="flex items-center gap-4">
                <Donut
                  data={[{ name: "Supply", value: cost!.supply, color: BLUE }, { name: "Dismantle & Install", value: cost!.install, color: AMBER }]}
                  center={<><p className="text-[11px] text-muted-foreground">{cost!.currency}</p><p className="text-xl font-bold">{compact(cost!.total)}</p></>}
                />
                <Legend items={[
                  { label: "Supply", value: `${share(cost!.supply, cost!.total)}%`, color: BLUE },
                  { label: "Dismantle & Install", value: `${share(cost!.install, cost!.total)}%`, color: AMBER },
                ]} />
              </div>
            ) : <Empty text="Add a quotation to see the cost split." />}
            {materials && materials.orderedValue > 0 && <p className="mt-3 border-t border-border pt-2 text-xs text-muted-foreground">Materials ordered so far: <span className="font-medium text-foreground">{cost?.currency ?? "EGP"} {money(materials.orderedValue)}</span></p>}
          </Panel>
        )}
      </div>

      {/* bottom row */}
      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr_0.85fr]">
        <Panel icon={<FileText className="h-4 w-4 text-primary" />} title="Reports">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-medium">Report Name</th><th className="pb-2 font-medium">Type</th><th className="pb-2 font-medium">Based on</th><th className="pb-2 text-right font-medium">Download</th></tr></thead>
            <tbody className="divide-y divide-border">
              {([
                schedule && { name: "Project Progress Report", type: "PDF", href: `/print/projects/${id}/planning`, newTab: true, basis: `Data date ${fmtLong(schedule.dataDate)}` },
                schedule && { name: "Schedule Report", type: "Excel", href: `/api/projects/${id}/planning/export?format=xlsx`, basis: `${schedule.kpis.totalActivities} activities` },
                canCost && hasCost && { name: "Cost Summary Report", type: "Excel", href: `/api/projects/${id}/quotations/export`, basis: `${cost!.quotations} quotation${cost!.quotations > 1 ? "s" : ""}` },
                materials && { name: "Material Usage Report", type: "Excel", href: `/api/projects/${id}/materials/export`, basis: `${materials.items} materials` },
              ].filter(Boolean) as { name: string; type: "PDF" | "Excel"; href: string; newTab?: boolean; basis: string }[]).map((r) => (
                <tr key={r.name}>
                  <td className="py-2.5 font-medium text-primary">{r.name}</td>
                  <td className="py-2.5"><TypeBadge type={r.type} /></td>
                  <td className="py-2.5 text-xs text-muted-foreground">{r.basis}</td>
                  <td className="py-2.5 text-right"><a href={r.href} {...(r.newTab ? { target: "_blank", rel: "noreferrer" } : {})} aria-label={`Download ${r.name}`} className="inline-flex rounded-md p-1.5 text-primary hover:bg-primary/10"><Download className="h-4 w-4" /></a></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!schedule && !materials && !hasCost && <Empty text="Nothing to report yet — add a schedule, materials or a quotation." />}
        </Panel>

        <Panel icon={<Waypoints className="h-4 w-4 text-primary" />} title="Performance Indicators" action={<span className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: BLUE }} />SPI</span>}>
          {schedule && schedule.spi.length > 0 ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={schedule.spi} margin={{ top: 18, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, (max: number) => Math.max(1.5, Math.ceil(max * 10) / 10)]} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v) => [Number(v).toFixed(2), "SPI"]} contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }} />
                  <ReferenceLine y={1} stroke="#94a3b8" strokeDasharray="4 3" />
                  <Bar dataKey="spi" radius={[4, 4, 0, 0]} label={{ position: "top", fontSize: 11, formatter: (v: unknown) => Number(v).toFixed(2) }}>
                    {schedule.spi.map((s) => <Cell key={s.day} fill={s.spi >= 1 ? GREEN : s.spi >= 0.9 ? AMBER : "#dc2626"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : <Empty text={schedule ? "SPI appears once the schedule has progressed past its first month." : "Create a schedule to see performance indicators."} />}
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">SPI = actual % complete ÷ planned %. Above 1.0 means ahead of plan. Cost index (CPI) needs actual costs, which are not tracked yet.</p>
        </Panel>

        <Panel icon={<Download className="h-4 w-4 text-primary" />} title="Export Reports">
          <div className="space-y-2">
            {schedule && <ExportRow icon={<FileText className="h-4 w-4 text-red-600" />} label="Export Project Report (PDF)" href={`/print/projects/${id}/planning`} newTab />}
            {schedule && <ExportRow icon={<FileSpreadsheet className="h-4 w-4 text-green-600" />} label="Export Schedule (Excel)" href={`/api/projects/${id}/planning/export?format=xlsx`} />}
            {canCost && hasCost && <ExportRow icon={<FileSpreadsheet className="h-4 w-4 text-green-600" />} label="Export Cost Report (Excel)" href={`/api/projects/${id}/quotations/export`} />}
            {materials && <ExportRow icon={<FileSpreadsheet className="h-4 w-4 text-green-600" />} label="Export Materials (Excel)" href={`/api/projects/${id}/materials/export`} />}
            {schedule && <ExportRow icon={<span className="flex h-4 w-4 items-center justify-center rounded-sm bg-red-600 text-[8px] font-bold text-white">P6</span>} label="Export to Primavera P6 (XER)" href={`/api/projects/${id}/planning/export?format=xer`} />}
            {!schedule && !materials && !hasCost && <Empty text="No exports available yet." />}
          </div>
        </Panel>
      </div>
    </div>
  );
}

const share = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

function Kpi({ icon, tint, label, value, valueClass, children }: { icon: React.ReactNode; tint: string; label: string; value: string; valueClass?: string; children?: React.ReactNode }) {
  return (
    <Card><CardContent className="flex items-start gap-3 p-4">
      <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tint)}>{icon}</div>
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-muted-foreground">{label}</p><p className={cn("truncate text-2xl font-semibold tracking-tight", valueClass)}>{value}</p>{children}</div>
    </CardContent></Card>
  );
}

function Panel({ icon, title, action, children }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-3"><CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle>{action}</CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function Donut({ data, center }: { data: { name: string; value: number; color: string }[]; center: React.ReactNode }) {
  return (
    <div className="relative h-44 w-44 shrink-0">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">{center}</div>
    </div>
  );
}

function Legend({ items }: { items: { label: string; value: string; color: string }[] }) {
  return (
    <ul className="min-w-0 flex-1 space-y-2.5">
      {items.map((i) => (
        <li key={i.label} className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: i.color }} /><span className="truncate">{i.label}</span></span><span className="font-semibold">{i.value}</span></li>
      ))}
    </ul>
  );
}

function TypeBadge({ type }: { type: "PDF" | "Excel" }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", type === "PDF" ? "bg-red-500/10 text-red-700" : "bg-green-500/10 text-green-700")}>{type}</span>;
}

function ExportRow({ icon, label, href, newTab }: { icon: React.ReactNode; label: string; href: string; newTab?: boolean }) {
  return (
    <a href={href} {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted/50">
      <span className="flex items-center gap-2.5">{icon}{label}</span><ChevronRight className="h-4 w-4 text-muted-foreground" />
    </a>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-32 items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground"><AlertCircle className="h-4 w-4 shrink-0" />{text}</div>;
}

function NoSchedule({ id, canEdit }: { id: string; canEdit: boolean }) {
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
      <p>This project has no schedule yet.</p>
      {canEdit && <Link href={`/projects/${id}/planning`} className="font-medium text-primary hover:underline">Create one in Planning</Link>}
    </div>
  );
}
