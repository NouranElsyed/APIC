"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { planApi } from "./api";
import type { PlanActivityDTO, PlanningData } from "./dto";
import type { ImportReport } from "@/server/services/planning.service";
import type { RelType } from "./types";

const selectCls = "flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-1.5", className)}><Label className="text-xs">{label}</Label>{children}</div>;
}
function WorkWeek({ value, onChange }: { value: boolean[]; onChange: (v: boolean[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {DAYS.map((d, i) => (
        <button key={d} type="button" onClick={() => onChange(value.map((v, j) => (j === i ? !v : v)))}
          className={cn("h-8 w-12 rounded-md border text-xs font-medium transition-colors", value[i] ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card text-muted-foreground hover:bg-secondary")}>
          {d}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ create schedule
export function CreateScheduleDialog({ open, onOpenChange, projectId, defaultName, defaultStart }: { open: boolean; onOpenChange: (o: boolean) => void; projectId: string; defaultName: string; defaultStart?: string | null }) {
  const router = useRouter();
  const [name, setName] = React.useState(defaultName);
  const [start, setStart] = React.useState(defaultStart ?? today());
  const [workDays, setWorkDays] = React.useState([true, true, true, true, true, false, false]);
  const [starter, setStarter] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/planning`, { method: "POST", body: { name, startDate: start, workDays, starterWbs: starter } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Schedule created");
    onOpenChange(false);
    router.refresh();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>New schedule</DialogTitle><DialogDescription>Start a Primavera-style schedule for this project.</DialogDescription></DialogHeader>
        <div className="space-y-4">
          <Field label="Schedule name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Project start date"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Working days"><WorkWeek value={workDays} onChange={setWorkDays} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={starter} onChange={(e) => setStarter(e.target.checked)} /> Add starter WBS (Engineering, Procurement, Fabrication, Installation)</label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={busy || name.trim().length < 2 || !start}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ------------------------------------------------------------------------- activity
interface PredRow { activityId: string; type: RelType; lagDays: number }

function ActivityForm({ onOpenChange, projectId, data, activity, defaultWbsId }: { onOpenChange: (o: boolean) => void; projectId: string; data: PlanningData; activity: PlanActivityDTO | null; defaultWbsId?: string | null }) {
  const router = useRouter();
  const isEdit = !!activity;
  const [f, setF] = React.useState(() => init(activity, defaultWbsId, data));
  const [preds, setPreds] = React.useState<PredRow[]>(() => activity?.predecessors.map((p) => ({ activityId: p.activityId, type: p.type, lagDays: p.lagDays })) ?? []);
  const [busy, setBusy] = React.useState(false);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const milestone = f.type !== "TASK";
  const options = data.activities.filter((a) => a.id !== activity?.id);
  const wbsOptions = flattenWbs(data);

  async function submit() {
    setBusy(true);
    const body = {
      name: f.name, code: f.code || undefined, wbsId: f.wbsId || null, type: f.type, durationDays: milestone ? 0 : Number(f.durationDays) || 0,
      calendarId: f.calendarId || null, percentComplete: Number(f.percentComplete) || 0,
      actualStart: f.actualStart || null, actualFinish: f.actualFinish || null,
      constraintType: f.constraintType || null, constraintDate: f.constraintType ? f.constraintDate || null : null,
      predecessors: preds.filter((p) => p.activityId).map((p) => ({ ...p, lagDays: Number(p.lagDays) || 0 })),
    };
    const r = await planApi(isEdit ? `/api/projects/${projectId}/planning/activities/${activity!.id}` : `/api/projects/${projectId}/planning/activities`, { method: isEdit ? "PATCH" : "POST", body });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(isEdit ? "Activity updated" : "Activity added");
    onOpenChange(false);
    router.refresh();
  }
  async function remove() {
    if (!activity || !confirm(`Delete activity ${activity.code}? Links to it are removed too.`)) return;
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/planning/activities/${activity.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Activity deleted");
    onOpenChange(false);
    router.refresh();
  }

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><DialogTitle>{isEdit ? `Edit ${activity!.code}` : "New activity"}</DialogTitle><DialogDescription>Durations are working days of the activity calendar. Dates recalculate from the logic.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Activity name" className="sm:col-span-2"><Input value={f.name} onChange={(e) => set("name", e.target.value)} autoFocus /></Field>
          <Field label="Activity ID"><Input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="Auto" /></Field>
          <Field label="WBS">
            <select className={selectCls} value={f.wbsId} onChange={(e) => set("wbsId", e.target.value)}>
              <option value="">— none —</option>
              {wbsOptions.map((w) => <option key={w.id} value={w.id}>{"\u00A0\u00A0".repeat(w.level)}{w.code} · {w.name}</option>)}
            </select>
          </Field>
          <Field label="Type">
            <select className={selectCls} value={f.type} onChange={(e) => set("type", e.target.value as typeof f.type)}>
              <option value="TASK">Task</option><option value="MILESTONE_START">Start milestone</option><option value="MILESTONE_FINISH">Finish milestone</option>
            </select>
          </Field>
          <Field label="Original duration (days)"><Input type="number" min={0} step="0.5" disabled={milestone} value={milestone ? 0 : f.durationDays} onChange={(e) => set("durationDays", e.target.value)} /></Field>
          <Field label="Calendar">
            <select className={selectCls} value={f.calendarId} onChange={(e) => set("calendarId", e.target.value)}>
              <option value="">Project default</option>
              {data.calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="% complete"><Input type="number" min={0} max={100} value={f.percentComplete} onChange={(e) => set("percentComplete", e.target.value)} /></Field>
          <Field label="Actual start"><Input type="date" value={f.actualStart} onChange={(e) => set("actualStart", e.target.value)} /></Field>
          <Field label="Actual finish"><Input type="date" value={f.actualFinish} onChange={(e) => set("actualFinish", e.target.value)} /></Field>
          <Field label="Constraint">
            <div className="flex gap-2">
              <select className={selectCls} value={f.constraintType} onChange={(e) => set("constraintType", e.target.value)}>
                <option value="">None</option><option value="SNET">Start no earlier than</option><option value="SNLT">Start no later than</option><option value="FNET">Finish no earlier than</option><option value="FNLT">Finish no later than</option>
              </select>
              {f.constraintType && <Input type="date" value={f.constraintDate} onChange={(e) => set("constraintDate", e.target.value)} />}
            </div>
          </Field>
        </div>

        <div className="space-y-2 rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Predecessors</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setPreds((p) => [...p, { activityId: "", type: "FS", lagDays: 0 }])}><Plus className="h-4 w-4" /> Add</Button>
          </div>
          {preds.length === 0 && <p className="text-xs text-muted-foreground">No predecessors — this activity starts at the project start (or its constraint).</p>}
          {preds.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_72px_84px_32px] items-center gap-2">
              <select className={selectCls} value={p.activityId} onChange={(e) => setPreds((a) => a.map((x, j) => (j === i ? { ...x, activityId: e.target.value } : x)))}>
                <option value="">Choose activity…</option>
                {options.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
              </select>
              <select className={selectCls} value={p.type} onChange={(e) => setPreds((a) => a.map((x, j) => (j === i ? { ...x, type: e.target.value as RelType } : x)))}>
                {["FS", "SS", "FF", "SF"].map((t) => <option key={t}>{t}</option>)}
              </select>
              <Input type="number" step="0.5" value={p.lagDays} title="Lag (days)" onChange={(e) => setPreds((a) => a.map((x, j) => (j === i ? { ...x, lagDays: Number(e.target.value) } : x)))} />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => setPreds((a) => a.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {preds.length > 0 && <p className="text-[11px] text-muted-foreground">Type: FS finish→start, SS start→start, FF finish→finish, SF start→finish. Lag in working days (negative = lead).</p>}
        </div>

        <DialogFooter className="sm:justify-between">
          {isEdit ? <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /> Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={busy || !f.name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {isEdit ? "Save" : "Add activity"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
  );
}

function init(a: PlanActivityDTO | null, wbsId: string | null | undefined, data: PlanningData) {
  return {
    name: a?.name ?? "", code: a?.code ?? "", wbsId: a?.wbsId ?? wbsId ?? "", type: (a?.type ?? "TASK") as PlanActivityDTO["type"],
    durationDays: String(a?.durationDays ?? 5), calendarId: a?.calendarId ?? "", percentComplete: String(Math.round(a?.percentComplete ?? 0)),
    actualStart: a?.actualStart ?? "", actualFinish: a?.actualFinish ?? "", constraintType: a?.constraintType ?? "", constraintDate: a?.constraintDate ?? data.schedule.startDate,
  };
}

export function flattenWbs(data: PlanningData) {
  const out: { id: string; code: string; name: string; level: number }[] = [];
  const walk = (parent: string | null, level: number) => {
    for (const w of data.wbs.filter((x) => x.parentId === parent).sort((a, b) => a.sortOrder - b.sortOrder)) {
      out.push({ id: w.id, code: w.code, name: w.name, level });
      walk(w.id, level + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function ActivityDialog(props: Parameters<typeof ActivityForm>[0] & { open: boolean }) {
  const { open, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      {open && <ActivityForm key={rest.activity?.id ?? "new"} {...rest} />}
    </Dialog>
  );
}

// ----------------------------------------------------------------------------- WBS
function WbsForm({ onOpenChange, projectId, data, wbsId }: { onOpenChange: (o: boolean) => void; projectId: string; data: PlanningData; wbsId?: string | null }) {
  const router = useRouter();
  const cur = wbsId ? data.wbs.find((w) => w.id === wbsId) : null;
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function submit() {
    setBusy(true);
    const r = await planApi(cur ? `/api/projects/${projectId}/planning/wbs/${cur.id}` : `/api/projects/${projectId}/planning/wbs`, { method: cur ? "PATCH" : "POST", body: { code, name, parentId: parentId || null } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    onOpenChange(false);
    router.refresh();
  }
  async function remove() {
    if (!cur || !confirm(`Delete WBS "${cur.name}"?`)) return;
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/planning/wbs/${cur.id}`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    onOpenChange(false);
    router.refresh();
  }
  const parents = flattenWbs(data).filter((w) => w.id !== cur?.id);
  return (
    <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>{cur ? "Edit WBS element" : "New WBS element"}</DialogTitle><DialogDescription>WBS groups activities into phases (Engineering, Fabrication…).</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="Name" className="sm:col-span-2"><Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
          <Field label="Parent" className="sm:col-span-3">
            <select className={selectCls} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">Top level</option>
              {parents.map((w) => <option key={w.id} value={w.id}>{"\u00A0\u00A0".repeat(w.level)}{w.code} · {w.name}</option>)}
            </select>
          </Field>
        </div>
        <DialogFooter className="sm:justify-between">
          {cur ? <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={remove} disabled={busy}><Trash2 className="h-4 w-4" /> Delete</Button> : <span />}
          <div className="flex gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={busy || !code.trim() || !name.trim()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button></div>
        </DialogFooter>
      </DialogContent>
  );
}

export function WbsDialog(props: Parameters<typeof WbsForm>[0] & { open: boolean }) {
  const { open, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      {open && <WbsForm key={rest.wbsId ?? "new"} {...rest} />}
    </Dialog>
  );
}

// -------------------------------------------------------------------------- settings
function SettingsForm({ onOpenChange, projectId, data, canDelete }: { onOpenChange: (o: boolean) => void; projectId: string; data: PlanningData; canDelete: boolean }) {
  const router = useRouter();
  const cal = data.calendars.find((c) => c.isDefault) ?? data.calendars[0];
  const [name, setName] = React.useState(data.schedule.name);
  const [start, setStart] = React.useState(data.schedule.startDate);
  const [dataDate, setDataDate] = React.useState(data.schedule.dataDate);
  const [workDays, setWorkDays] = React.useState(cal?.workDays ?? [true, true, true, true, true, false, false]);
  const [hours, setHours] = React.useState(String(cal?.hoursPerDay ?? 8));
  const [holidays, setHolidays] = React.useState((cal?.holidays ?? []).join("\n"));
  const [baselineName, setBaselineName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    const list = holidays.split(/[\s,;]+/).filter(Boolean);
    if (list.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h))) return void toast.error("Holidays must be YYYY-MM-DD dates, one per line.");
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/planning`, { method: "PATCH", body: { name, startDate: start, dataDate, calendar: { workDays, holidays: list, hoursPerDay: Number(hours) || 8 } } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Schedule updated and recalculated");
    onOpenChange(false);
    router.refresh();
  }
  async function baseline() {
    if (!confirm("Save the current dates as the baseline? It replaces the existing baseline used for delay and SPI.")) return;
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/planning/baseline`, { method: "POST", body: { name: baselineName || undefined } });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success("Baseline saved");
    router.refresh();
  }
  async function destroy() {
    if (!confirm("Delete this whole schedule (activities, links, baselines, progress history)? This cannot be undone.")) return;
    setBusy(true);
    const r = await planApi(`/api/projects/${projectId}/planning`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    onOpenChange(false);
    router.refresh();
  }
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Schedule settings</DialogTitle><DialogDescription>Changing dates or the calendar recalculates every activity.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Schedule name" className="sm:col-span-3"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Project start"><Input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Data date (status date)"><Input type="date" value={dataDate} onChange={(e) => setDataDate(e.target.value)} /></Field>
          <Field label="Hours per day"><Input type="number" min={1} max={24} value={hours} onChange={(e) => setHours(e.target.value)} /></Field>
          <Field label="Working days" className="sm:col-span-3"><WorkWeek value={workDays} onChange={setWorkDays} /></Field>
          <Field label="Holidays (YYYY-MM-DD, one per line)" className="sm:col-span-3"><textarea className="min-h-20 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring" value={holidays} onChange={(e) => setHolidays(e.target.value)} placeholder={"2026-12-25\n2027-01-07"} /></Field>
        </div>
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-sm font-medium">Baseline</p>
          <p className="text-xs text-muted-foreground">{data.baseline ? `Current: “${data.baseline.name}” saved ${new Date(data.baseline.createdAt).toLocaleDateString("en-GB")}.` : "No baseline yet — save one once the plan is approved so delay and SPI can be measured."}</p>
          <div className="flex gap-2"><Input value={baselineName} onChange={(e) => setBaselineName(e.target.value)} placeholder="Baseline name (optional)" /><Button variant="outline" onClick={baseline} disabled={busy}>Save baseline</Button></div>
        </div>
        <DialogFooter className="sm:justify-between">
          {canDelete ? <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={destroy} disabled={busy}><Trash2 className="h-4 w-4" /> Delete schedule</Button> : <span />}
          <div className="flex gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={save} disabled={busy || name.trim().length < 2}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button></div>
        </DialogFooter>
      </DialogContent>
  );
}

export function SettingsDialog(props: Parameters<typeof SettingsForm>[0] & { open: boolean }) {
  const { open, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      {open && <SettingsForm key={"settings"} {...rest} />}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------- import
function Summary({ r }: { r: ImportReport }) {
  const c = r.changes;
  if (r.mode === "update" && c) {
    const rows: [string, number][] = [["New activities", c.created], ["Changed", c.updated], ["Unchanged", c.unchanged], ["Removed", c.removed], ["Kept (not in file)", c.keptNotInFile], ["WBS added / renamed", c.wbsCreated + c.wbsUpdated]];
    return <dl className="grid grid-cols-3 gap-2">{rows.map(([k, v]) => <div key={k} className="rounded-lg bg-secondary px-3 py-2"><dt className="text-[11px] text-muted-foreground">{k}</dt><dd className="text-lg font-semibold">{v}</dd></div>)}</dl>;
  }
  return <p>{r.activities} activities, {r.relationships} links, {r.wbs} WBS elements and {r.calendars} calendars.</p>;
}

function ImportForm({ onOpenChange, projectId, hasSchedule }: { onOpenChange: (o: boolean) => void; projectId: string; hasSchedule: boolean }) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [mode, setMode] = React.useState<"update" | "replace">("update");
  const [keepProgress, setKeepProgress] = React.useState(false);
  const [removeMissing, setRemoveMissing] = React.useState(false);
  const [p6Project, setP6Project] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState<ImportReport | null>(null);
  const [report, setReport] = React.useState<ImportReport | null>(null);
  const resetPreview = () => setPreview(null);

  async function run(dryRun: boolean) {
    if (!file) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", file);
    form.append("mode", hasSchedule ? mode : "update");
    if (keepProgress) form.append("keepProgress", "1");
    if (removeMissing) form.append("removeMissing", "1");
    if (p6Project) form.append("p6ProjectId", p6Project);
    if (dryRun) form.append("dryRun", "1");
    try {
      const res = await fetch(`/api/projects/${projectId}/planning/import`, { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(json?.error ?? "Import failed");
      else if (dryRun) setPreview(json as ImportReport);
      else { setReport(json as ImportReport); router.refresh(); }
    } catch { toast.error("Network error — please try again."); }
    setBusy(false);
  }

  const updating = hasSchedule && mode === "update";
  const radio = (value: "update" | "replace", title: string, text: string, tone?: string) => (
    <label className={cn("flex cursor-pointer gap-3 rounded-xl border p-3", mode === value ? "border-primary bg-primary/5" : "border-border hover:bg-secondary/40")}>
      <input type="radio" name="mode" className="mt-1" checked={mode === value} onChange={() => { setMode(value); resetPreview(); }} />
      <span className="text-sm"><b className={tone}>{title}</b><span className="block text-xs text-muted-foreground">{text}</span></span>
    </label>
  );
  const check = (checked: boolean, on: (v: boolean) => void, label: string) => (
    <label className="flex cursor-pointer items-center gap-2 pl-9 text-xs"><input type="checkbox" checked={checked} onChange={(e) => { on(e.target.checked); resetPreview(); }} /> {label}</label>
  );

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Import from Primavera P6 (XER)</DialogTitle><DialogDescription>In P6: File → Export → Primavera PM (XER), then choose the file here.</DialogDescription></DialogHeader>
      {report ? (
        <div className="space-y-3 text-sm">
          <div className="font-medium text-green-700">{report.mode === "update" ? "Schedule updated." : "Imported."}</div>
          <Summary r={report} />
          <p className="text-xs text-muted-foreground">Dates were recalculated with the schedule engine (like pressing F9 in P6).{report.dateDifferences > 0 ? ` ${report.dateDifferences} activities finish on a different date than stored in the file — compare them with P6 before relying on the result.` : " All finish dates match the file."}</p>
          {report.warnings.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-6 text-xs text-amber-800">{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <DialogFooter><Button onClick={() => onOpenChange(false)}>Done</Button></DialogFooter>
        </div>
      ) : (
        <div className="space-y-4">
          {hasSchedule && (
            <div className="space-y-2">
              {radio("update", "Update the existing schedule", "Matches activities by Activity ID. Baseline, progress history and material links are kept; new activities are added.")}
              {mode === "update" && <>{check(keepProgress, setKeepProgress, "Keep the % complete and actual dates already entered here")}{check(removeMissing, setRemoveMissing, "Remove activities that are not in the file")}</>}
              {radio("replace", "Replace it", "Deletes the current activities, links, baseline and progress history first.", "text-red-600")}
            </div>
          )}
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center hover:bg-secondary/50">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">{file ? file.name : "Choose an .xer file"}</span>
            <span className="text-xs text-muted-foreground">Up to 25 MB</span>
            <input type="file" accept=".xer,.txt" className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); resetPreview(); setP6Project(""); }} />
          </label>
          {preview && preview.projects.length > 1 && (
            <div>
              <Label className="mb-1.5 block text-xs">This file has {preview.projects.length} projects — import:</Label>
              <select className="flex h-9 w-full rounded-lg border border-input bg-card px-3 text-sm" value={p6Project || preview.projects[0].id} onChange={(e) => { setP6Project(e.target.value); resetPreview(); }}>
                {preview.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          )}
          {preview && (
            <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
              <p className="text-xs font-semibold text-muted-foreground">Preview — nothing has been changed yet</p>
              <Summary r={preview} />
              {preview.warnings.length > 0 && <ul className="list-disc space-y-1 rounded-lg bg-amber-50 p-3 pl-6 text-xs text-amber-800">{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
            </div>
          )}
          {hasSchedule && mode === "replace" && <p className="rounded-lg bg-red-50 p-3 text-xs text-red-700">Replacing cannot be undone: the baseline, progress history and links from materials to activities are lost.</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="outline" onClick={() => run(true)} disabled={!file || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Preview</Button>
            <Button onClick={() => run(false)} disabled={!file || busy} className={hasSchedule && mode === "replace" ? "bg-red-600 text-white hover:bg-red-700" : undefined}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} {updating ? "Update schedule" : hasSchedule ? "Replace schedule" : "Import"}</Button>
          </DialogFooter>
        </div>
      )}
    </DialogContent>
  );
}

export function ImportDialog(props: Parameters<typeof ImportForm>[0] & { open: boolean }) {
  const { open, ...rest } = props;
  return (
    <Dialog open={open} onOpenChange={rest.onOpenChange}>
      {open && <ImportForm key={"import"} {...rest} />}
    </Dialog>
  );
}
