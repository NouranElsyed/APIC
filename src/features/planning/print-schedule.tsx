"use client";
import * as React from "react";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GanttChart, fmtLong, type GanttZoom } from "./gantt-chart";
import { isoToDay } from "./calendar";
import type { PlanningData } from "./dto";

/** Print-friendly time schedule: pick a zoom that fits the page, then use the browser's "Save as PDF". */
export function PrintSchedule({ data, title }: { data: PlanningData; title: string }) {
  const span = React.useMemo(() => {
    const days = data.rows.flatMap((r) => [r.start, r.finish, r.baselineStart, r.baselineFinish]).filter(Boolean).map((d) => isoToDay(d as string));
    return days.length ? Math.max(...days) - Math.min(...days) : 0;
  }, [data.rows]);
  const zoom: GanttZoom = span <= 150 ? "week" : span <= 500 ? "month" : "quarter";
  const k = data.kpis;
  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-6 print:p-0">
      <style>{`@page { size: A3 landscape; margin: 10mm; } @media print { .no-print { display: none !important; } body { background: #fff; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <div className="no-print flex justify-end"><Button onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save as PDF</Button></div>
      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-border pb-3">
        <div><h1 className="text-xl font-semibold">{title}</h1><p className="text-sm text-muted-foreground">{data.schedule.name}</p></div>
        <div className="text-right text-xs text-muted-foreground">
          <p>Data date: <b className="text-foreground">{fmtLong(data.schedule.dataDate)}</b></p>
          <p>Progress: <b className="text-foreground">{Math.round(k.progress)}%</b> · Finish: <b className="text-foreground">{fmtLong(k.currentFinish)}</b>{k.hasBaseline && <> · Delay: <b className="text-foreground">{k.delayDays > 0 ? `+${k.delayDays}` : k.delayDays} days</b></>}</p>
        </div>
      </div>
      <GanttChart rows={data.rows} activities={data.activities} dataDate={data.schedule.dataDate} zoom={zoom} showBaseline={!!data.baseline} maxHeight={null} />
      <p className="text-[11px] text-muted-foreground">Blue = planned · Red = critical · Green = complete · Grey = baseline · Dashed line = data date.</p>
    </div>
  );
}
