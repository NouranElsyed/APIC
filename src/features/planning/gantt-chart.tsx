"use client";
import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { dayToIso, isoToDay } from "./calendar";
import type { PlanRow } from "./metrics";
import type { PlanActivityDTO } from "./dto";

export type GanttZoom = "week" | "month" | "quarter";

const ROW_H = 32;
const HEAD_H = 44;
const PPD: Record<GanttZoom, number> = { week: 9, month: 3.6, quarter: 1.4 };
const COLS = [
  { key: "outline", label: "#", w: 52 },
  { key: "code", label: "ID", w: 72 },
  { key: "name", label: "Activity Name", w: 232 },
  { key: "duration", label: "Dur", w: 52 },
  { key: "start", label: "Start", w: 70 },
  { key: "finish", label: "Finish", w: 70 },
  { key: "percent", label: "%", w: 52 },
  { key: "float", label: "Float", w: 54 },
] as const;
const LEFT_W = COLS.reduce((s, c) => s + c.w, 0);

// Full class names so Tailwind can see them (no string concatenation).
const BAR_TONES = {
  done: { solid: "bg-green-600", track: "bg-green-600/25" },
  critical: { solid: "bg-red-500", track: "bg-red-500/25" },
  normal: { solid: "bg-blue-600", track: "bg-blue-600/25" },
} as const;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtShort = (iso: string) => {
  if (!iso) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
};
export const fmtLong = (iso: string | null) => {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]} ${y}`;
};
const fmtDur = (n: number) => `${Math.round(n * 10) / 10}d`;

export function GanttChart({
  rows, activities, dataDate, zoom, showBaseline, selectedId, onSelect, onOpen, maxHeight = 620,
}: {
  rows: PlanRow[];
  activities: PlanActivityDTO[];
  dataDate: string;
  zoom: GanttZoom;
  showBaseline: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onOpen?: (id: string) => void;
  maxHeight?: number | null;
}) {
  const ppd = PPD[zoom];
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const scrollRef = React.useRef<HTMLDivElement>(null);

  // Rows hidden because an ancestor WBS is collapsed.
  const visible = React.useMemo(() => {
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const hidden = (r: PlanRow): boolean => {
      let p = r.parentKey;
      while (p) {
        if (collapsed.has(p)) return true;
        p = byKey.get(p)?.parentKey ?? null;
      }
      return false;
    };
    return rows.filter((r) => !hidden(r));
  }, [rows, collapsed]);

  // Time axis.
  const { origin, totalDays } = React.useMemo(() => {
    const days: number[] = [isoToDay(dataDate)];
    for (const r of rows) {
      if (r.start) days.push(isoToDay(r.start));
      if (r.finish) days.push(isoToDay(r.finish));
      if (showBaseline && r.baselineStart) days.push(isoToDay(r.baselineStart));
      if (showBaseline && r.baselineFinish) days.push(isoToDay(r.baselineFinish));
    }
    const min = Math.min(...days) - 7;
    const max = Math.max(...days) + 21;
    // Snap the origin back to the 1st of its month so month headers line up.
    const d = new Date(min * 86_400_000);
    const origin = isoToDay(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10));
    return { origin, totalDays: max - origin + 1 };
  }, [rows, dataDate, showBaseline]);

  const x = (day: number) => (day - origin) * ppd;
  const timelineW = Math.max(400, totalDays * ppd);
  const dataX = x(isoToDay(dataDate));

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, dataX - 160);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  // Header segments.
  const header = React.useMemo(() => {
    const top: { label: string; left: number; width: number }[] = [];
    const ticks: { left: number; label: string }[] = [];
    const end = origin + totalDays;
    let d = origin;
    while (d < end) {
      const dt = new Date(d * 86_400_000);
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth();
      const stepMonths = zoom === "quarter" ? 3 - (m % 3) : 1;
      const next = isoToDay(new Date(Date.UTC(y, m + stepMonths, 1)).toISOString().slice(0, 10));
      const label = zoom === "quarter" ? `Q${Math.floor(m / 3) + 1} ${y}` : `${MONTHS[m]} ${y}`;
      top.push({ label, left: x(d), width: (Math.min(next, end) - d) * ppd });
      d = next;
    }
    if (zoom === "week") {
      const dow = (((origin + 4) % 7) + 7) % 7;
      for (let w = origin + ((7 - dow) % 7); w < end; w += 7) ticks.push({ left: x(w), label: dayToIso(w).slice(8) });
    }
    return { top, ticks };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, totalDays, zoom]);

  // Dependency connectors.
  const rowIndex = new Map(visible.map((r, i) => [r.key, i]));
  const rowById = new Map(rows.map((r) => [r.key, r]));
  const links: { d: string; critical: boolean }[] = [];
  for (const a of activities) {
    const si = rowIndex.get(`a:${a.id}`);
    if (si === undefined) continue;
    const sRow = rowById.get(`a:${a.id}`)!;
    for (const p of a.predecessors) {
      const pi = rowIndex.get(`a:${p.activityId}`);
      if (pi === undefined) continue;
      const pRow = rowById.get(`a:${p.activityId}`)!;
      const pL = x(isoToDay(pRow.start));
      const pR = x(isoToDay(pRow.finish) + 1);
      const sL = x(isoToDay(sRow.start));
      const sR = x(isoToDay(sRow.finish) + 1);
      const fromX = p.type === "FS" || p.type === "FF" ? (pRow.type && pRow.type !== "TASK" ? pL : pR) : pL;
      const toX = p.type === "FS" || p.type === "SS" ? sL : sR;
      const yA = pi * ROW_H + ROW_H / 2;
      const yB = si * ROW_H + ROW_H / 2;
      const out = p.type === "FS" || p.type === "FF" ? 6 : -6;
      const into = p.type === "FS" || p.type === "SS" ? -6 : 6;
      let d: string;
      if ((out > 0 && toX + into >= fromX + out) || (out < 0 && toX + into <= fromX + out)) {
        d = `M${fromX},${yA} H${fromX + out} V${yB} H${toX}`;
      } else {
        const yMid = yB > yA ? yA + ROW_H / 2 : yA - ROW_H / 2;
        d = `M${fromX},${yA} H${fromX + out} V${yMid} H${toX + into} V${yB} H${toX}`;
      }
      links.push({ d, critical: pRow.critical && sRow.critical });
    }
  }

  const toggle = (key: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  return (
    <div
      ref={scrollRef}
      className="relative overflow-auto rounded-xl border border-border bg-card"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <div className="flex" style={{ width: LEFT_W + timelineW }}>
        {/* ---------------- left: activity table ---------------- */}
        <div className="sticky left-0 z-20 shrink-0 border-r border-border bg-card shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]" style={{ width: LEFT_W }}>
          <div className="sticky top-0 z-30 flex items-center border-b border-border bg-secondary text-[11px] font-semibold text-muted-foreground" style={{ height: HEAD_H }}>
            {COLS.map((c) => (
              <div key={c.key} className={cn("px-2", c.key !== "name" && c.key !== "outline" && c.key !== "code" && "text-right")} style={{ width: c.w }}>{c.label}</div>
            ))}
          </div>
          {visible.map((r) => {
            const sel = r.kind === "activity" && r.id === selectedId;
            const isWbs = r.kind === "wbs";
            return (
              <div
                key={r.key}
                onClick={() => r.kind === "activity" && onSelect?.(sel ? null : r.id)}
                onDoubleClick={() => r.kind === "activity" && onOpen?.(r.id)}
                className={cn("flex items-center border-b border-border/60 text-xs", isWbs ? "bg-secondary/60 font-semibold" : "cursor-pointer hover:bg-secondary/40", sel && "bg-primary/10 hover:bg-primary/10")}
                style={{ height: ROW_H }}
              >
                <div className="truncate px-2 text-muted-foreground" style={{ width: COLS[0].w }}>{r.outline}</div>
                <div className="truncate px-2 text-muted-foreground" style={{ width: COLS[1].w }}>{isWbs ? "" : r.code}</div>
                <div className="flex min-w-0 items-center gap-1 px-2" style={{ width: COLS[2].w, paddingLeft: 8 + r.level * 14 }}>
                  {isWbs && r.hasChildren ? (
                    <button type="button" onClick={(e) => { e.stopPropagation(); toggle(r.key); }} className="shrink-0 text-muted-foreground hover:text-foreground">
                      {collapsed.has(r.key) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  ) : <span className="w-3.5 shrink-0" />}
                  <span className={cn("truncate", r.critical && !isWbs && "text-destructive")} title={r.name}>{r.name}</span>
                </div>
                <div className="px-2 text-right tabular-nums" style={{ width: COLS[3].w }}>{r.type && r.type !== "TASK" ? "0d" : r.start ? fmtDur(r.duration) : ""}</div>
                <div className="px-2 text-right tabular-nums" style={{ width: COLS[4].w }}>{r.start ? fmtShort(r.start) : ""}</div>
                <div className="px-2 text-right tabular-nums" style={{ width: COLS[5].w }}>{r.finish ? fmtShort(r.finish) : ""}</div>
                <div className="px-2 text-right tabular-nums" style={{ width: COLS[6].w }}>{r.start ? `${r.percent}%` : ""}</div>
                <div className={cn("px-2 text-right tabular-nums", r.start && r.float <= 0 && !r.done && "font-semibold text-destructive")} style={{ width: COLS[7].w }}>{r.start ? (r.done ? "—" : Math.round(r.float)) : ""}</div>
              </div>
            );
          })}
        </div>

        {/* ---------------- right: timeline ---------------- */}
        <div className="relative shrink-0" style={{ width: timelineW }}>
          <div className="sticky top-0 z-10 border-b border-border bg-secondary" style={{ height: HEAD_H }}>
            {header.top.map((t) => (
              <div key={t.label + t.left} className="absolute top-0 flex h-[22px] items-center border-l border-border/70 px-2 text-[11px] font-semibold text-muted-foreground" style={{ left: t.left, width: t.width }}>
                <span className="truncate">{t.label}</span>
              </div>
            ))}
            {header.ticks.map((t) => (
              <div key={t.left} className="absolute top-[22px] h-[22px] border-l border-border/50 pl-1 text-[10px] leading-[22px] text-muted-foreground" style={{ left: t.left }}>{t.label}</div>
            ))}
            <div className="absolute top-[26px] z-20 -translate-x-1/2 whitespace-nowrap rounded bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow" style={{ left: dataX }}>
              Data date · {fmtLong(dataDate)}
            </div>
          </div>

          <div className="relative" style={{ height: visible.length * ROW_H }}>
            {header.top.map((t) => (
              <div key={"g" + t.left} className="absolute top-0 h-full border-l border-border/50" style={{ left: t.left }} />
            ))}
            {visible.map((r, i) => (
              <div key={"b" + r.key} className={cn("absolute left-0 w-full border-b border-border/40", r.kind === "wbs" && "bg-secondary/40", r.kind === "activity" && r.id === selectedId && "bg-primary/5")} style={{ top: i * ROW_H, height: ROW_H }} />
            ))}

            <svg className="pointer-events-none absolute inset-0" width={timelineW} height={visible.length * ROW_H}>
              <defs>
                <marker id="arr" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#94a3b8" /></marker>
                <marker id="arr-c" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#dc2626" /></marker>
              </defs>
              {links.map((l, i) => (
                <path key={i} d={l.d} fill="none" stroke={l.critical ? "#dc2626" : "#94a3b8"} strokeWidth={1} markerEnd={l.critical ? "url(#arr-c)" : "url(#arr)"} />
              ))}
              <line x1={dataX} x2={dataX} y1={0} y2={visible.length * ROW_H} stroke="#1d4ed8" strokeWidth={1.5} strokeDasharray="4 3" />
            </svg>

            {visible.map((r, i) => {
              if (!r.start || !r.finish) return null;
              const top = i * ROW_H;
              const left = x(isoToDay(r.start));
              const width = Math.max(4, (isoToDay(r.finish) + 1 - isoToDay(r.start)) * ppd);
              const tip = `${r.code} ${r.name}\n${fmtLong(r.start)} → ${fmtLong(r.finish)}${r.kind === "activity" ? `\n${r.percent}% · float ${Math.round(r.float)}d` : ""}`;
              const bl = showBaseline && r.baselineStart && r.baselineFinish
                ? <div className="absolute rounded-sm bg-slate-400/70" style={{ top: top + ROW_H - 9, height: 4, left: x(isoToDay(r.baselineStart)), width: Math.max(4, (isoToDay(r.baselineFinish) + 1 - isoToDay(r.baselineStart)) * ppd) }} title={`Baseline ${fmtLong(r.baselineStart)} → ${fmtLong(r.baselineFinish)}`} />
                : null;

              if (r.kind === "wbs") {
                return (
                  <React.Fragment key={"s" + r.key}>
                    <div className="absolute rounded-sm bg-slate-800" style={{ top: top + 10, height: 7, left, width }} title={tip}>
                      <div className="h-full rounded-sm bg-blue-500" style={{ width: `${r.percent}%` }} />
                    </div>
                    <div className="absolute h-2.5 w-0 border-y-[5px] border-l-[5px] border-y-transparent border-l-slate-800" style={{ top: top + 17, left }} />
                    <div className="absolute h-2.5 w-0 border-y-[5px] border-r-[5px] border-y-transparent border-r-slate-800" style={{ top: top + 17, left: left + width - 5 }} />
                    {bl}
                  </React.Fragment>
                );
              }
              if (r.type && r.type !== "TASK") {
                const mx = r.type === "MILESTONE_FINISH" ? x(isoToDay(r.finish) + 1) : left;
                return (
                  <React.Fragment key={"m" + r.key}>
                    <div className={cn("absolute h-3.5 w-3.5 rotate-45 cursor-pointer", r.done ? "bg-green-600" : r.critical ? "bg-red-500" : "bg-amber-500")} style={{ top: top + 9, left: mx - 7 }} title={tip} onClick={() => onSelect?.(r.id === selectedId ? null : r.id)} onDoubleClick={() => onOpen?.(r.id)} />
                    {bl}
                  </React.Fragment>
                );
              }
              const tone = BAR_TONES[r.done ? "done" : r.critical ? "critical" : "normal"];
              return (
                <React.Fragment key={"t" + r.key}>
                  <div
                    className={cn("absolute cursor-pointer overflow-hidden rounded", tone.track, r.id === selectedId && "ring-2 ring-primary/50")}
                    style={{ top: top + 7, height: 15, left, width }}
                    title={tip}
                    onClick={() => onSelect?.(r.id === selectedId ? null : r.id)}
                    onDoubleClick={() => onOpen?.(r.id)}
                  >
                    <div className={cn("h-full", tone.solid)} style={{ width: `${r.percent}%` }} />
                    {r.percent < 100 && r.critical && <div className="absolute inset-0" style={{ background: "repeating-linear-gradient(45deg, rgba(255,255,255,.45) 0 3px, transparent 3px 6px)", left: `${r.percent}%` }} />}
                    {width > 46 && <span className="absolute inset-0 flex items-center px-1.5 text-[10px] font-semibold text-white mix-blend-normal" style={{ textShadow: "0 0 2px rgba(0,0,0,.45)" }}>{r.percent > 0 ? `${r.percent}%` : ""}</span>}
                  </div>
                  {bl}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
