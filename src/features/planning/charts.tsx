"use client";
import * as React from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { dayToIso } from "./calendar";
import type { SCurve, WbsProgress } from "./metrics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (day: number, withYear = false) => {
  const [y, m, d] = dayToIso(day).split("-").map(Number);
  return withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ""}`;
};

export function SCurveChart({ data, hasBaseline, height = 240 }: { data: SCurve; hasBaseline: boolean; height?: number }) {
  const rows = React.useMemo(() => {
    const byDay = new Map<number, { day: number; plan?: number; baseline?: number | null; actual?: number }>();
    const row = (day: number) => byDay.get(day) ?? byDay.set(day, { day }).get(day)!;
    for (const p of data.points) { const r = row(p.day); r.plan = p.plan; r.baseline = p.baseline; }
    for (const a of data.actual) row(a.day).actual = a.value;
    return [...byDay.values()].sort((a, b) => a.day - b.day);
  }, [data]);
  if (rows.length < 2) return <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">Add activities to see the S-curve.</div>;

  const first = rows[0].day;
  const last = rows[rows.length - 1].day;
  // One tick per month start.
  const ticks: number[] = [];
  const d0 = new Date(first * 86_400_000);
  for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth() + 1; ; m++) {
    const day = Math.round(Date.UTC(y, m, 1) / 86_400_000);
    if (day > last) break;
    ticks.push(day);
  }
  const thin = ticks.length > 14 ? ticks.filter((_, i) => i % Math.ceil(ticks.length / 12) === 0) : ticks;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 18, right: 16, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="day" type="number" domain={[first, last]} ticks={thin} tickFormatter={(v) => label(v)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
        <Tooltip
          labelFormatter={(v) => label(Number(v), true)}
          formatter={(v, name) => [`${Number(v).toFixed(1)}%`, name === "plan" ? "Plan" : name === "actual" ? "Actual" : "Baseline"]}
          contentStyle={{ borderRadius: 10, border: "1px solid var(--border)", fontSize: 12 }}
        />
        <ReferenceLine x={data.dataDay} stroke="#1d4ed8" strokeDasharray="4 3" label={{ value: "Today", position: "top", fill: "#1d4ed8", fontSize: 11, fontWeight: 600 }} />
        {hasBaseline && <Line dataKey="baseline" name="baseline" stroke="#94a3b8" strokeDasharray="5 4" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />}
        <Line dataKey="plan" name="plan" stroke="#1d4ed8" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
        <Line dataKey="actual" name="actual" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ChartLegend({ hasBaseline }: { hasBaseline: boolean }) {
  const item = (color: string, text: string, dashed = false) => (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="inline-block h-0.5 w-5" style={{ background: dashed ? `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)` : color, height: 3 }} />
      {text}
    </span>
  );
  return <div className="flex items-center gap-4">{item("#1d4ed8", "Plan")}{item("#16a34a", "Actual")}{hasBaseline && item("#94a3b8", "Baseline", true)}</div>;
}

const WBS_COLORS = ["#1d4ed8", "#16a34a", "#f59e0b", "#7c3aed", "#0f9d8f", "#db2777", "#64748b"];

export function WbsDonut({ items, overall }: { items: WbsProgress[]; overall: number }) {
  if (items.length === 0) return <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">No WBS elements yet.</div>;
  // Each slice is that element's share of the whole project (equal split keeps small elements visible), shaded by its own progress.
  const slices = items.map((w, i) => ({ ...w, color: WBS_COLORS[i % WBS_COLORS.length] }));
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-44 w-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey={() => 1} innerRadius={56} outerRadius={80} paddingAngle={2} stroke="none" isAnimationActive={false}>
              {slices.map((s) => <Cell key={s.id} fill={s.color} fillOpacity={0.25 + 0.75 * (s.progress / 100)} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-foreground">{Math.round(overall)}%</span>
          <span className="text-[10px] text-muted-foreground">Overall</span>
        </div>
      </div>
      <ul className="w-full space-y-2 text-sm">
        {slices.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: s.color }} /><span className="truncate">{s.name}</span></span>
            <span className="font-semibold tabular-nums">{s.progress}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProgressRing({ value, size = 56, stroke = 7, color = "#16a34a" }: { value: number; size?: number; stroke?: number; color?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="shrink-0 -rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--secondary)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(100, Math.max(0, value)) / 100)} />
    </svg>
  );
}
