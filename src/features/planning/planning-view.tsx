"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, ClipboardList, Download, FileSpreadsheet, FileText,
  Flag, GanttChartSquare, CalendarRange, Loader2, Plus, Settings2, Target, Truck, Upload, Zap, Circle, Gauge, Clock3, CircleDollarSign, Hourglass,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/shared/empty-state";
import { cn } from "@/lib/utils";
import { GanttChart, fmtLong, fmtShort, type GanttZoom } from "./gantt-chart";
import { ChartLegend, ProgressRing, SCurveChart, WbsDonut } from "./charts";
import { ActivityDialog, CreateScheduleDialog, ImportDialog, SettingsDialog, WbsDialog } from "./planning-dialogs";
import { planApi } from "./api";
import type { PlanActivityDTO, PlanningData } from "./dto";
import { MaterialsView } from "./materials-view";
import type { MaterialsData } from "@/server/services/materials.service";

type View = "overview" | "gantt" | "scurve" | "table" | "materials";
const VIEWS: { id: View; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "gantt", label: "Gantt View" },
  { id: "scurve", label: "S-Curve" },
  { id: "table", label: "Table" },
  { id: "materials", label: "Materials" },
];

const selectCls = "h-9 rounded-lg border border-input bg-card pl-3 pr-8 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-ring";
const softBtn = "h-9 border-transparent bg-secondary text-foreground shadow-none hover:bg-secondary/70";

// Full class strings so Tailwind keeps them.
const ALERT_STYLES = {
  DELAYED: { bar: "border-l-red-500", chip: "bg-red-50 text-red-700", label: "Delayed" },
  AT_RISK: { bar: "border-l-amber-500", chip: "bg-amber-50 text-amber-700", label: "At Risk" },
  COMPLETED: { bar: "border-l-green-500", chip: "bg-green-50 text-green-700", label: "Completed" },
} as const;

export function PlanningView({
  projectId, projectLabel, data, materials, canEdit, canDelete, defaultName, defaultStart,
}: {
  projectId: string; projectLabel: string; data: PlanningData | null; materials: MaterialsData; canEdit: boolean; canDelete: boolean; defaultName: string; defaultStart: string | null;
}) {
  const [view, setView] = React.useState<View>("gantt");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);

  if (!data) {
    return (
      <>
        <EmptyState
          icon={<GanttChartSquare />}
          title="No schedule for this project yet"
          description={canEdit ? "Build a schedule here, or import one you already made in Primavera P6 (XER)." : "A schedule has not been created for this project."}
          action={canEdit ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New schedule</Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4" /> Import from P6 (XER)</Button>
            </div>
          ) : undefined}
        />
        <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} projectId={projectId} defaultName={defaultName} defaultStart={defaultStart} />
        <ImportDialog open={importOpen} onOpenChange={setImportOpen} projectId={projectId} hasSchedule={false} />
      </>
    );
  }
  return <Loaded {...{ projectId, projectLabel, data, materials, canEdit, canDelete, view, setView }} />;
}

function Loaded({ projectId, projectLabel, data, materials, canEdit, canDelete, view, setView }: {
  projectId: string; projectLabel: string; data: PlanningData; materials: MaterialsData; canEdit: boolean; canDelete: boolean; view: View; setView: (v: View) => void;
}) {
  const [zoom, setZoom] = React.useState<GanttZoom>("month");
  const [showBaseline, setShowBaseline] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [activityDialog, setActivityDialog] = React.useState<{ open: boolean; activity: PlanActivityDTO | null; wbsId?: string | null }>({ open: false, activity: null });
  const [wbsDialog, setWbsDialog] = React.useState<{ open: boolean; id?: string | null }>({ open: false });
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const k = data.kpis;
  const actById = React.useMemo(() => new Map(data.activities.map((a) => [a.id, a])), [data.activities]);
  const openActivity = (id: string) => { const a = actById.get(id); if (a && canEdit) setActivityDialog({ open: true, activity: a }); };
  const base = `/api/projects/${projectId}/planning`;

  const exportBtns = (
    <>
      <Button variant="outline" size="sm" className={softBtn} asChild><a href={`${base}/export?format=xer`}><Download className="h-4 w-4 text-primary" /> Export to P6</a></Button>
      <Button variant="outline" size="sm" className={softBtn} asChild><a href={`${base}/export?format=xlsx`}><FileSpreadsheet className="h-4 w-4 text-green-600" /> Export Excel</a></Button>
      <Button variant="outline" size="sm" className={softBtn} asChild><a href={`/print/projects/${projectId}/planning`} target="_blank" rel="noreferrer"><FileText className="h-4 w-4 text-red-600" /> Export PDF</a></Button>
    </>
  );

  return (
    <div className="space-y-5">
      {data.schedule.calcError && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{data.schedule.calcError}</div>}

      {/* ------- view switch + toolbar ------- */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-3 shadow-sm">
        <div className="inline-flex rounded-xl bg-secondary p-1">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)} className={cn("rounded-lg px-4 py-1.5 text-sm font-medium transition-colors", view === v.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{v.label}</button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {view === "gantt" && (
            <>
              <label className="relative flex items-center">
                <CalendarRange className="pointer-events-none absolute left-2.5 h-4 w-4 text-foreground/70" />
                <select value={zoom} onChange={(e) => setZoom(e.target.value as GanttZoom)} className={cn(selectCls, "pl-8")}>
                  <option value="week">Weekly</option><option value="month">Monthly</option><option value="quarter">Quarterly</option>
                </select>
              </label>
              <label className="relative flex items-center">
                <span className="pointer-events-none absolute left-3 h-2.5 w-2.5 rounded-full bg-foreground" />
                <select value={showBaseline && data.baseline ? "show" : "hide"} disabled={!data.baseline} onChange={(e) => setShowBaseline(e.target.value === "show")} className={cn(selectCls, "pl-8 disabled:opacity-50")} title={data.baseline ? undefined : "Save a baseline first"}>
                  <option value="show">Baseline</option><option value="hide">No baseline</option>
                </select>
              </label>
              <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
            </>
          )}
          {view !== "materials" && canEdit && <Button variant="outline" size="sm" className={softBtn} onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 text-primary" /> Import from P6</Button>}
          {view !== "materials" && exportBtns}
          {view !== "materials" && canEdit && <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSettingsOpen(true)} title="Schedule settings"><Settings2 className="h-4 w-4" /></Button>}
        </div>
      </div>

      {view === "overview" && <Overview data={data} base={base} canEdit={canEdit} onImport={() => setImportOpen(true)} materials={materials} onOpenMaterials={() => setView("materials")} />}

      {(view === "gantt" || view === "table") && canEdit && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setActivityDialog({ open: true, activity: null, wbsId: data.activities.find((a) => a.id === selectedId)?.wbsId })}><Plus className="h-4 w-4" /> Add activity</Button>
          <Button size="sm" variant="outline" onClick={() => setWbsDialog({ open: true, id: null })}><Plus className="h-4 w-4" /> Add WBS</Button>
          {data.wbs.length > 0 && <select className="h-8 rounded-md border border-input bg-card px-2 text-xs shadow-sm" value="" onChange={(e) => e.target.value && setWbsDialog({ open: true, id: e.target.value })}><option value="">Edit WBS…</option>{data.wbs.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}</select>}
        </div>
      )}

      {view === "gantt" && (
        <>
          {data.rows.length === 0 ? <EmptyState icon={<GanttChartSquare />} title="No activities yet" description={canEdit ? "Add a WBS element and your first activity, or import an XER file." : undefined} /> : (
            <GanttChart rows={data.rows} activities={data.activities} dataDate={data.schedule.dataDate} zoom={zoom} showBaseline={showBaseline && !!data.baseline} selectedId={selectedId} onSelect={setSelectedId} onOpen={openActivity} />
          )}
          {canEdit && data.rows.length > 0 && <p className="text-xs text-muted-foreground">Click a row to select it, double-click an activity (or its bar) to edit.</p>}
          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr_1.3fr]">
            <Card><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">Project Progress – S-Curve</CardTitle><ChartLegend hasBaseline={k.hasBaseline} /></CardHeader><CardContent><SCurveChart data={data.scurve} hasBaseline={k.hasBaseline} height={200} /></CardContent></Card>
            <CriticalPathCard data={data} onOpen={openActivity} selectedId={selectedId} />
            <IndicatorsCard data={data} />
          </div>
        </>
      )}

      {view === "scurve" && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="text-sm">Project Progress – S-Curve</CardTitle><ChartLegend hasBaseline={k.hasBaseline} /></CardHeader>
          <CardContent>
            <SCurveChart data={data.scurve} hasBaseline={k.hasBaseline} height={380} />
            <p className="mt-3 text-xs text-muted-foreground">Plan = current schedule · Actual = recorded at each progress update (data date) · Baseline = saved baseline. Progress is weighted by activity duration.</p>
          </CardContent>
        </Card>
      )}

      {view === "materials" && <MaterialsView projectId={projectId} data={materials} canEdit={canEdit} />}

      {view === "table" && <FollowUpTable data={data} projectId={projectId} canEdit={canEdit} onEdit={openActivity} />}

      <ActivityDialog open={activityDialog.open} onOpenChange={(o) => setActivityDialog((s) => ({ ...s, open: o }))} projectId={projectId} data={data} activity={activityDialog.activity} defaultWbsId={activityDialog.wbsId} />
      <WbsDialog open={wbsDialog.open} onOpenChange={(o) => setWbsDialog((s) => ({ ...s, open: o }))} projectId={projectId} data={data} wbsId={wbsDialog.id} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} projectId={projectId} data={data} canDelete={canDelete} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} projectId={projectId} hasSchedule />
      <span className="sr-only">{projectLabel}</span>
    </div>
  );
}

// ------------------------------------------------------------------------- overview
function Overview({ data, base, canEdit, onImport, materials, onOpenMaterials }: { data: PlanningData; base: string; canEdit: boolean; onImport: () => void; materials: MaterialsData; onOpenMaterials: () => void }) {
  const k = data.kpis;
  const status = !k.hasBaseline ? { big: "No baseline", sub: "Save a baseline to track delay", tone: "slate" } : k.delayDays > 0 ? { big: `+${k.delayDays} Days`, sub: "Behind schedule", tone: "red" } : { big: k.delayDays < 0 ? `${k.delayDays} Days` : "On time", sub: "Ahead / on schedule", tone: "green" };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="bg-green-50/60"><CardContent className="flex items-center gap-4 p-5"><div className="relative"><ProgressRing value={k.progress} size={72} stroke={9} /><span className="absolute inset-0 flex items-center justify-center text-sm font-semibold">{Math.round(k.progress)}%</span></div><div><p className="font-semibold">Overall Progress</p><p className="text-xs text-muted-foreground">Project completion</p></div></CardContent></Card>
        <Card className={status.tone === "red" ? "bg-red-50/60" : status.tone === "green" ? "bg-green-50/60" : "bg-slate-50"}><CardContent className="p-5"><p className="font-semibold">Schedule Status</p><p className={cn("text-2xl font-semibold", status.tone === "red" && "text-red-600", status.tone === "green" && "text-green-600")}>{status.big}</p><p className="text-xs text-muted-foreground">{status.sub}</p></CardContent></Card>
        <Card className="bg-blue-50/60"><CardContent className="p-5"><p className="font-semibold">Total Activities</p><p className="text-2xl font-semibold">{k.totalActivities}</p><p className="text-xs text-muted-foreground">{k.notStarted} not started · {k.inProgress} in progress · {k.completed} done</p></CardContent></Card>
        <Card className="bg-orange-50/60"><CardContent className="p-5"><p className="font-semibold">Critical Activities</p><p className="text-2xl font-semibold text-orange-600">{k.criticalCount}</p><p className="text-xs text-muted-foreground">{k.criticalCount ? "Require attention" : "None on the critical path"}</p></CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2 text-sm"><Target className="h-4 w-4 text-primary" /> Project Progress</CardTitle><ChartLegend hasBaseline={k.hasBaseline} /></CardHeader><CardContent><SCurveChart data={data.scurve} hasBaseline={k.hasBaseline} height={260} /></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">WBS Progress</CardTitle></CardHeader><CardContent><WbsDonut items={data.wbsProgress} overall={k.progress} /></CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4 text-muted-foreground" /> Key Alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {data.alerts.length === 0 && <p className="py-4 text-center text-xs text-muted-foreground">Nothing needs attention right now.</p>}
            {data.alerts.map((a) => { const s = ALERT_STYLES[a.kind]; return (
              <div key={a.kind + a.id} className={cn("flex items-center gap-3 rounded-lg border border-border border-l-4 p-3", s.bar)}>
                <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold", s.chip)}>{s.label}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{a.name}</p><p className="truncate text-xs text-muted-foreground">{a.note}</p></div>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtShort(a.date)}</span>
              </div>); })}
          </CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Flag className="h-4 w-4 text-muted-foreground" /> Milestone Summary</CardTitle></CardHeader>
          <CardContent>
            {data.milestones.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">No milestones in this schedule.</p> : (
              <ol className="space-y-4">
                {data.milestones.map((m, i) => (
                  <li key={m.id} className="relative flex gap-3">
                    {i < data.milestones.length - 1 && <span className="absolute left-[9px] top-5 h-full w-px bg-border" />}
                    {m.status === "DONE" ? <CheckCircle2 className="z-10 h-5 w-5 shrink-0 fill-white text-green-600" /> : m.status === "NEXT" ? <Circle className="z-10 h-5 w-5 shrink-0 fill-white text-primary" strokeWidth={3} /> : <Circle className="z-10 h-5 w-5 shrink-0 fill-white text-muted-foreground/50" />}
                    <div><p className="text-sm font-medium">{m.name}</p><p className="text-xs text-muted-foreground">{m.status === "DONE" ? "Completed on" : "Expected on"} {fmtLong(m.date)}</p></div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent></Card>

        <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><ClipboardList className="h-4 w-4 text-muted-foreground" /> Quick Actions</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <QuickAction icon={<Upload className="h-5 w-5 text-primary" />} label="Import from P6 (XER)" onClick={canEdit ? onImport : undefined} />
            <QuickAction icon={<Download className="h-5 w-5 text-primary" />} label="Export to P6 (XER)" href={`${base}/export?format=xer`} />
            <QuickAction icon={<FileText className="h-5 w-5 text-red-600" />} label="Export Report (PDF)" href={`${base.replace("/api/projects/", "/print/projects/")}`} newTab />
            <QuickAction icon={<FileSpreadsheet className="h-5 w-5 text-green-600" />} label="Export Excel" href={`${base}/export?format=xlsx`} />
          </CardContent></Card>
      </div>

      {materials.summary.total > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle className="flex items-center gap-2 text-sm"><Truck className="h-4 w-4 text-muted-foreground" /> Material follow-up</CardTitle><Button variant="outline" size="sm" onClick={onOpenMaterials}>Open materials</Button></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div><p className="text-xs text-muted-foreground">Items tracked</p><p className="text-xl font-semibold">{materials.summary.total}</p></div>
            <div><p className="text-xs text-muted-foreground">Not ordered</p><p className="text-xl font-semibold text-red-600">{materials.summary.byStatus.NOT_ORDERED}</p>{materials.summary.urgent > 0 && <p className="text-[11px] text-red-600">{materials.summary.urgent} needed within 14 days</p>}</div>
            <div><p className="text-xs text-muted-foreground">Ordered / partial</p><p className="text-xl font-semibold text-blue-600">{materials.summary.byStatus.ORDERED + materials.summary.byStatus.PARTIAL}</p></div>
            <div><p className="text-xs text-muted-foreground">Delivered</p><p className="text-xl font-semibold text-green-600">{materials.summary.byStatus.DELIVERED}</p></div>
            <div><p className="text-xs text-muted-foreground">Late deliveries</p><p className={cn("text-xl font-semibold", materials.summary.byStatus.LATE > 0 && "text-red-600")}>{materials.summary.byStatus.LATE}</p></div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QuickAction({ icon, label, href, onClick, newTab }: { icon: React.ReactNode; label: string; href?: string; onClick?: () => void; newTab?: boolean }) {
  const cls = "flex flex-col items-center justify-center gap-2 rounded-xl border border-border p-4 text-center text-xs font-medium transition-colors hover:bg-secondary disabled:opacity-40";
  if (href) return <a href={href} className={cls} {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})}>{icon}{label}</a>;
  return <button type="button" onClick={onClick} disabled={!onClick} className={cls}>{icon}{label}</button>;
}

// --------------------------------------------------------------- gantt-view bottom cards
function CriticalPathCard({ data, onOpen, selectedId }: { data: PlanningData; onOpen: (id: string) => void; selectedId?: string | null }) {
  const list = data.criticalPath.slice(0, 6);
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 text-red-500" /> Critical Path</CardTitle></CardHeader>
      <CardContent className="space-y-1">
        {list.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">No critical activities.</p>}
        {list.map((c) => (
          <button key={c.id} type="button" onClick={() => onOpen(c.id)} className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-red-50", c.id === selectedId && "bg-red-50")}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
            <span className="shrink-0 text-xs text-muted-foreground">{c.code}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
            <span className="shrink-0 text-xs font-medium text-red-600">({Math.round(c.duration)}d)</span>
          </button>
        ))}
        {data.criticalPath.length > list.length && <p className="px-3 pt-1 text-xs text-muted-foreground">+{data.criticalPath.length - list.length} more</p>}
      </CardContent></Card>
  );
}

function IndicatorsCard({ data }: { data: PlanningData }) {
  const k = data.kpis;
  const spiPct = k.spi == null ? null : Math.round((k.spi - 1) * 100);
  const tile = (icon: React.ReactNode, label: string, value: React.ReactNode, sub?: React.ReactNode, tone?: string) => (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-secondary">{icon}</span>{label}</div>
      <p className={cn("text-2xl font-semibold tracking-tight", tone)}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
  return (
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Zap className="h-4 w-4 text-amber-500" /> Key Indicators</CardTitle></CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tile(<Gauge className="h-4 w-4 text-primary" />, "SPI", k.spi == null ? "—" : k.spi.toFixed(2), spiPct == null ? "needs progress" : <span className={cn("inline-flex items-center gap-0.5 font-medium", spiPct < 0 ? "text-red-600" : "text-green-600")}>{spiPct < 0 ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}{Math.abs(spiPct)}%</span>, k.spi != null && k.spi < 1 ? "text-red-600" : undefined)}
        {tile(<CircleDollarSign className="h-4 w-4 text-primary" />, "CPI", "—", "needs cost data")}
        {tile(<Clock3 className="h-4 w-4 text-primary" />, "Delay", !k.hasBaseline ? "—" : k.delayDays > 0 ? `+${k.delayDays} Days` : "On time", k.hasBaseline ? "vs baseline" : "no baseline", k.delayDays > 0 ? "text-red-600" : undefined)}
        {tile(<Hourglass className="h-4 w-4 text-primary" />, "Total Float", k.minFloat == null ? "—" : `${Math.round(k.minFloat)} Days`, "lowest open activity", k.minFloat != null && k.minFloat <= 0 ? "text-red-600" : "text-primary")}
      </CardContent></Card>
  );
}

// ------------------------------------------------------------- follow-up (progress) table
function FollowUpTable({ data, projectId, canEdit, onEdit }: { data: PlanningData; projectId: string; canEdit: boolean; onEdit: (id: string) => void }) {
  const router = useRouter();
  const [dataDate, setDataDate] = React.useState(data.schedule.dataDate);
  const [edits, setEdits] = React.useState<Record<string, { percentComplete?: number; actualStart?: string | null; actualFinish?: string | null }>>({});
  const [busy, setBusy] = React.useState(false);
  const actById = new Map(data.activities.map((a) => [a.id, a]));
  const dirty = Object.keys(edits).length > 0 || dataDate !== data.schedule.dataDate;
  const edit = (id: string, patch: (typeof edits)[string]) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  async function save() {
    setBusy(true);
    const r = await planApi<{ updated: number; percent: number }>(`/api/projects/${projectId}/planning/progress`, {
      method: "POST", body: { dataDate, updates: Object.entries(edits).map(([activityId, v]) => ({ activityId, ...v })) },
    });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(`Progress saved — project is ${r.data.percent}% complete`);
    setEdits({});
    router.refresh();
  }

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-sm">Progress follow-up</CardTitle>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">Data date <Input type="date" className="h-8 w-40" value={dataDate} onChange={(e) => setDataDate(e.target.value)} /></label>
            <Button size="sm" onClick={save} disabled={!dirty || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save progress</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[920px] text-xs">
          <thead><tr className="border-y border-border bg-secondary text-left text-[11px] font-semibold text-muted-foreground">
            {["#", "ID", "Activity", "Dur", "Start", "Finish", "Actual start", "Actual finish", "% done", "Float", ""].map((h, i) => <th key={i} className={cn("px-3 py-2", i >= 3 && i <= 9 && "text-right")}>{h}</th>)}
          </tr></thead>
          <tbody>
            {data.rows.map((r) => {
              if (r.kind === "wbs") return (
                <tr key={r.key} className="border-b border-border bg-secondary/60 font-semibold">
                  <td className="px-3 py-2 text-muted-foreground">{r.outline}</td><td /><td className="px-3 py-2" style={{ paddingLeft: 12 + r.level * 14 }}>{r.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.start ? `${Math.round(r.duration)}d` : ""}</td><td className="px-3 py-2 text-right tabular-nums">{r.start ? fmtShort(r.start) : ""}</td><td className="px-3 py-2 text-right tabular-nums">{r.finish ? fmtShort(r.finish) : ""}</td>
                  <td /><td /><td className="px-3 py-2 text-right tabular-nums">{r.start ? `${r.percent}%` : ""}</td><td /><td />
                </tr>
              );
              const a = actById.get(r.id)!;
              const e = edits[r.id] ?? {};
              const milestone = a.type !== "TASK";
              return (
                <tr key={r.key} className={cn("border-b border-border/60 hover:bg-secondary/30", e && edits[r.id] && "bg-amber-50/50")}>
                  <td className="px-3 py-1.5 text-muted-foreground">{r.outline}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{a.code}</td>
                  <td className={cn("px-3 py-1.5", a.isCritical && "text-destructive")} style={{ paddingLeft: 12 + r.level * 14 }}>{milestone && <span className="mr-1 text-amber-500">◆</span>}{a.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{milestone ? "0d" : `${Math.round(a.durationDays * 10) / 10}d`}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtShort(a.earlyStart)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtShort(a.earlyFinish)}</td>
                  <td className="px-3 py-1 text-right">{canEdit ? <input type="date" className="h-7 w-[118px] rounded border border-input bg-card px-1 text-xs" value={(e.actualStart !== undefined ? e.actualStart : a.actualStart) ?? ""} onChange={(ev) => edit(a.id, { actualStart: ev.target.value || null })} /> : fmtShort(a.actualStart ?? "")}</td>
                  <td className="px-3 py-1 text-right">{canEdit ? <input type="date" className="h-7 w-[118px] rounded border border-input bg-card px-1 text-xs" value={(e.actualFinish !== undefined ? e.actualFinish : a.actualFinish) ?? ""} onChange={(ev) => edit(a.id, { actualFinish: ev.target.value || null })} /> : fmtShort(a.actualFinish ?? "")}</td>
                  <td className="px-3 py-1 text-right">{canEdit ? <input type="number" min={0} max={100} disabled={milestone} className="h-7 w-16 rounded border border-input bg-card px-1 text-right text-xs disabled:opacity-40" value={Math.round(e.percentComplete ?? a.percentComplete)} onChange={(ev) => edit(a.id, { percentComplete: Math.min(100, Math.max(0, Number(ev.target.value) || 0)) })} /> : `${Math.round(a.percentComplete)}%`}</td>
                  <td className={cn("px-3 py-1.5 text-right tabular-nums", a.isCritical && "font-semibold text-destructive")}>{r.done ? "—" : Math.round(a.totalFloat)}</td>
                  <td className="px-3 py-1.5 text-right">{canEdit && <button type="button" onClick={() => onEdit(a.id)} className="text-primary hover:underline">Edit</button>}</td>
                </tr>
              );
            })}
            {data.rows.length === 0 && <tr><td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">No activities yet.</td></tr>}
          </tbody>
        </table>
      </CardContent>
      {canEdit && <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">Set the data date to the status date, enter each activity&apos;s % complete (or actual dates) and save. Entering 100% completes an activity on the data date; the schedule then recalculates and the S-curve gets a new “Actual” point.</p>}
    </Card>
  );
}
