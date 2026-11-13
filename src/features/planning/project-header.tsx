"use client";
import { AlertTriangle, CalendarCheck, CalendarClock, Factory } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ProgressRing } from "./charts";
import { fmtLong } from "./gantt-chart";
import type { PlanningData } from "./dto";

/** Project name + number on the left, the four schedule KPIs on the right (as in the design). */
export function ProjectHeader({ name, number, kpis }: { name: string; number: string; kpis: PlanningData["kpis"] | null }) {
  const k = kpis;
  const delay = !k ? "—" : !k.hasBaseline ? "No baseline" : k.delayDays > 0 ? `+${k.delayDays} Days` : k.delayDays < 0 ? `${k.delayDays} Days` : "On time";
  const late = !!k && k.hasBaseline && k.delayDays > 0;
  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(300px,1.5fr)_repeat(4,minmax(0,1fr))]">
      <ProjectIdentity name={name} number={number} />
      <Stat icon={<CalendarClock className="h-5 w-5 text-primary" />} tint="bg-primary/10" label="Planned Finish" value={k ? fmtLong(k.plannedFinish) : "—"} />
      <Stat icon={<CalendarCheck className="h-5 w-5 text-green-600" />} tint="bg-green-500/10" label="Actual Finish" value={k?.actualFinish ? fmtLong(k.actualFinish) : "—"} />
      <Card><CardContent className="flex items-center gap-3 p-4">
        <div className="relative shrink-0"><ProgressRing value={k?.progress ?? 0} /><span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">{Math.round(k?.progress ?? 0)}%</span></div>
        <div><p className="text-xs font-medium text-muted-foreground">Overall Progress</p><p className="text-xl font-semibold tracking-tight">{Math.round(k?.progress ?? 0)}%</p></div>
      </CardContent></Card>
      <Stat icon={<AlertTriangle className={cn("h-5 w-5", late ? "text-red-600" : "text-green-600")} />} tint={late ? "bg-red-500/10" : "bg-green-500/10"} label="Delay" value={delay} valueClass={late ? "text-red-600" : undefined} />
    </div>
  );
}

function Stat({ icon, tint, label, value, valueClass }: { icon: React.ReactNode; tint: string; label: string; value: string; valueClass?: string }) {
  return (
    <Card><CardContent className="flex items-center gap-3 p-4">
      <div className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-xl", tint)}>{icon}</div>
      <div className="min-w-0"><p className="truncate text-xs font-medium text-muted-foreground">{label}</p><p className={cn("truncate text-xl font-semibold tracking-tight", valueClass)}>{value}</p></div>
    </CardContent></Card>
  );
}

export function ProjectIdentity({ name, number }: { name: string; number: string }) {
  return (
    <Card className="lg:col-span-2 xl:col-span-1">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-300 via-blue-500 to-slate-800 text-white shadow-sm"><Factory className="h-7 w-7" /></div>
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold leading-tight text-foreground" title={name}>{name}</h2>
          <span className="mt-1.5 inline-block rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Project #{number}</span>
        </div>
      </CardContent>
    </Card>
  );
}
