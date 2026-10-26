"use client";
/**
 * Nozzle schedule: type DN / projection / quantity, get neck, flange, pad and total weight per row, the schedule
 * totals and the flat parts (pads, manhole rings and covers) that go to nesting. Rows live on this page only.
 */
import * as React from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PIPE_STD, PAD_THK } from "./data";
import { calcNozzle, scheduleTotals, type NozzleInput, type NozzleKind, type NozzleLocation, type NozzleOutcome } from "./calc";

interface Row {
  id: number;
  mark: string;
  location: NozzleLocation;
  kind: NozzleKind;
  dn: number;
  projection: string;
  qty: string;
  padDia: string;
  padThk: string;
  noPad: boolean;
  flangeKg: string;
}

const DNS = Object.keys(PIPE_STD).map(Number);
const selectCls = "h-8 rounded-lg border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const fmt = (v: number, d = 2) => v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const optNum = (s: string) => (s.trim() === "" ? undefined : Number(s.replace(",", ".")));

const blank = (id: number, over: Partial<Row> = {}): Row => ({
  id, mark: `N${id}`, location: "shell", kind: "nozzle", dn: 150, projection: "200", qty: "1", padDia: "", padThk: "", noPad: false, flangeKg: "", ...over,
});

function toInput(r: Row): NozzleInput {
  return {
    mark: r.mark, location: r.location, kind: r.kind, dn: r.dn,
    projectionMm: Number(r.projection.replace(",", ".")), qty: Number(r.qty),
    padDiaMm: optNum(r.padDia), padThkMm: optNum(r.padThk), noPad: r.noPad || undefined, flangeKg: optNum(r.flangeKg),
  };
}

export function NozzlesView() {
  const next = React.useRef(3);
  const [rows, setRows] = React.useState<Row[]>(() => [blank(1, { mark: "N1", dn: 250 }), blank(2, { mark: "M1", kind: "manhole", dn: 600 })]);
  const [open, setOpen] = React.useState<Set<number>>(() => new Set());

  const results = React.useMemo(() => rows.map((r) => calcNozzle(toInput(r))), [rows]);
  const totals = React.useMemo(() => scheduleTotals(results), [results]);

  const patch = (id: number, p: Partial<Row>) => setRows((l) => l.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => setRows((l) => [...l, blank(next.current, { mark: `N${next.current++}` })]);
  const dup = (r: Row) => setRows((l) => { const i = l.findIndex((x) => x.id === r.id); const c = { ...r, id: next.current, mark: `${r.mark}-copy` }; next.current++; return [...l.slice(0, i + 1), c, ...l.slice(i + 1)]; });
  const del = (id: number) => setRows((l) => l.filter((r) => r.id !== id));
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const setKind = (r: Row, kind: NozzleKind) => patch(r.id, kind === "manhole" ? { kind, dn: 600 } : { kind, dn: r.dn === 600 ? 150 : r.dn });

  const outcomeOf = (i: number): NozzleOutcome => results[i];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">Nozzle schedule</h1>
        <p className="text-sm text-muted-foreground">
          Neck = projection × pipe kg/m · flange from the class 150 table · pad = ring of Ø pad / Ø pipe × thickness. DN50 and smaller have no pad.
          Nothing here is saved yet.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[1000px] text-sm">
          <thead className="bg-secondary text-left text-xs text-muted-foreground">
            <tr>
              {["Mark", "Location", "Type", "DN", "Projection (mm)", "Qty", "OD (mm)", "Neck (kg)", "Flange (kg)", "Pad", "Pad (kg)", "Unit (kg)", "Total (kg)", ""].map((h) => (
                <th key={h} className="p-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const o = outcomeOf(i);
              const isOpen = open.has(r.id);
              return (
                <React.Fragment key={r.id}>
                  <tr className="border-t border-border align-top">
                    <td className="p-1.5"><Input className="h-8 w-24" value={r.mark} onChange={(e) => patch(r.id, { mark: e.target.value })} aria-label="Mark" /></td>
                    <td className="p-1.5">
                      <select className={selectCls} value={r.location} onChange={(e) => patch(r.id, { location: e.target.value as NozzleLocation })} aria-label="Location">
                        <option value="shell">Shell</option>
                        <option value="roof">Roof</option>
                      </select>
                    </td>
                    <td className="p-1.5">
                      <select className={selectCls} value={r.kind} onChange={(e) => setKind(r, e.target.value as NozzleKind)} aria-label="Type">
                        <option value="nozzle">Nozzle</option>
                        <option value="manhole">Manhole API-650</option>
                      </select>
                    </td>
                    <td className="p-1.5">
                      <select className={selectCls} value={r.dn} disabled={r.kind === "manhole"} onChange={(e) => patch(r.id, { dn: Number(e.target.value) })} aria-label="DN">
                        {DNS.filter((d) => r.kind === "manhole" || d !== 600).map((d) => <option key={d} value={d}>DN{d}</option>)}
                      </select>
                    </td>
                    <td className="p-1.5"><Input className="h-8 w-24" inputMode="decimal" value={r.projection} onChange={(e) => patch(r.id, { projection: e.target.value })} aria-label="Projection" /></td>
                    <td className="p-1.5"><Input className="h-8 w-16" inputMode="numeric" value={r.qty} onChange={(e) => patch(r.id, { qty: e.target.value })} aria-label="Quantity" /></td>
                    {o.ok ? (
                      <>
                        <td className="p-2 tabular-nums">{fmt(o.odMm, 1)}</td>
                        <td className="p-2 tabular-nums">{fmt(o.neckKg)}</td>
                        <td className="p-2 tabular-nums" title={o.flangeSource === "fabricated" ? "Made from plate: see the manhole parts below" : undefined}>
                          {o.flangeSource === "fabricated" ? "plate" : fmt(o.flangeKg)}
                        </td>
                        <td className="p-2 text-xs">
                          {o.pad.diaMm ? `Ø${o.pad.diaMm} × ${o.pad.thkMm}` : "none"}
                          {(o.pad.source === "other-location" || o.pad.source === "estimate") && <span className="ml-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">check</span>}
                          {o.overrides.length > 0 && <span className="ml-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-800" title={o.overrides.join("; ")}>edited</span>}
                        </td>
                        <td className="p-2 tabular-nums">{fmt(o.padKg)}</td>
                        <td className="p-2 tabular-nums">{fmt(o.unitKg)}</td>
                        <td className="p-2 font-semibold tabular-nums">{fmt(o.totalKg)}</td>
                      </>
                    ) : (
                      <td className="p-2 text-xs text-red-700" colSpan={7}>{o.error}</td>
                    )}
                    <td className="whitespace-nowrap p-1.5 text-right">
                      <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => toggle(r.id)}>{isOpen ? "Hide" : "Override"}</Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Duplicate" onClick={() => dup(r)}><Copy /></Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive" aria-label="Delete" onClick={() => del(r.id)}><Trash2 /></Button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-secondary/40">
                      <td colSpan={14} className="p-2">
                        <div className="flex flex-wrap items-end gap-3 text-xs">
                          <label className="space-y-1">Pad Ø (mm)<Input className="h-8 w-24" inputMode="decimal" placeholder="default" value={r.padDia} onChange={(e) => patch(r.id, { padDia: e.target.value })} /></label>
                          <label className="space-y-1">Pad thickness (mm)<Input className="h-8 w-24" inputMode="decimal" placeholder={String(PAD_THK[r.location])} value={r.padThk} onChange={(e) => patch(r.id, { padThk: e.target.value })} /></label>
                          <label className="space-y-1">Flange weight (kg)<Input className="h-8 w-24" inputMode="decimal" placeholder="catalogue" disabled={r.kind === "manhole"} value={r.flangeKg} onChange={(e) => patch(r.id, { flangeKg: e.target.value })} /></label>
                          <label className="flex items-center gap-1.5 pb-2"><input type="checkbox" checked={r.noPad} onChange={(e) => patch(r.id, { noPad: e.target.checked })} /> No reinforcing pad</label>
                          <span className="pb-2 text-muted-foreground">Leave empty to use the library values.</span>
                        </div>
                        {o.ok && o.warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{o.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={14} className="p-6 text-center text-muted-foreground">No nozzles yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <Button variant="outline" size="sm" onClick={add}><Plus /> Add nozzle</Button>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["Nozzles", String(totals.count)],
          ["Neck pipes", `${fmt(totals.neckKg)} kg`],
          ["Flanges", `${fmt(totals.flangeKg)} kg`],
          ["Reinforcing pads", `${fmt(totals.padKg)} kg`],
          ["Schedule total", `${fmt(totals.totalKg)} kg`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-card p-3">
            <div className="text-xs text-muted-foreground">{k}</div>
            <div className="text-base font-semibold tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      {totals.errors > 0 && <p className="text-sm text-red-700">{totals.errors} row{totals.errors === 1 ? "" : "s"} with errors are not in the totals.</p>}

      {totals.flatParts.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Flat parts to cut (for nesting)</h2>
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-left text-xs text-muted-foreground">
                <tr>{["Part", "Ø outer (mm)", "Ø inner (mm)", "Thk (mm)", "Qty", "Each (kg)", "Total (kg)"].map((h) => <th key={h} className="p-2 font-medium">{h}</th>)}</tr>
              </thead>
              <tbody>
                {totals.flatParts.map((p) => (
                  <tr key={p.name} className="border-t border-border">
                    <td className="p-2">{p.name}</td>
                    <td className="p-2 tabular-nums">{p.outerDia}</td>
                    <td className="p-2 tabular-nums">{p.innerDia || "—"}</td>
                    <td className="p-2 tabular-nums">{p.thkMm}</td>
                    <td className="p-2 tabular-nums">{p.qty}</td>
                    <td className="p-2 tabular-nums">{fmt(p.kgEach)}</td>
                    <td className="p-2 tabular-nums">{fmt(p.kgEach * p.qty)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totals.fabricatedKg > 0 && (
            <p className="text-xs text-muted-foreground">
              Manhole rings and covers ({fmt(totals.fabricatedKg)} kg) are not in the schedule total: the tank workbook counts them with the tank components.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
