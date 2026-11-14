"use client";
import { BadgeCheck, CalendarDays, TriangleAlert } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtLong } from "@/features/planning/gantt-chart";
import { ProjectIdentity } from "@/features/planning/project-header";
import type { ScheduleStatus, StatusTone } from "./project-report";

const TONE_CHIP: Record<StatusTone, string> = {
  good: "bg-green-500/10 text-green-700", warn: "bg-amber-500/10 text-amber-700", bad: "bg-red-500/10 text-red-700", muted: "bg-muted text-muted-foreground",
};

/** Project name + number, start / end dates and the schedule-status chip (shared by the Reports and Material & Usage tabs). */
export function ProjectStrip({ name, number, startDate, endDate, status }: { name: string; number: string; startDate: string | null; endDate: string | null; status: ScheduleStatus }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(300px,1.6fr)_repeat(3,minmax(0,1fr))]">
      <ProjectIdentity name={name} number={number} />
      <DateCard label="Start Date" value={startDate} />
      <DateCard label="End Date" value={endDate} />
      <Card><CardContent className="flex h-full items-center justify-center p-4">
        <span className={cn("inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-base font-semibold", TONE_CHIP[status.tone])}>
          {status.tone === "good" ? <BadgeCheck className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />} {status.label}
        </span>
      </CardContent></Card>
    </div>
  );
}

function DateCard({ label, value }: { label: string; value: string | null }) {
  return (
    <Card><CardContent className="flex items-center gap-3 p-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10"><CalendarDays className="h-5 w-5 text-primary" /></div>
      <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="truncate text-lg font-semibold tracking-tight">{value ? fmtLong(value) : "—"}</p></div>
    </CardContent></Card>
  );
}
