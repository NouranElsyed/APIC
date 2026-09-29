"use client";
import * as React from "react";
import { Check, FolderOpen, Pencil, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import type { Group, OptResult, Settings, Sheet } from "./engine";

/** The sheet/setting inputs of the page (all strings, exactly as typed). */
export interface NestCfg {
  W: string; H: string; mg: string; gp: string; cell: string; ro: string; tm: string; pair: boolean; common: boolean;
}

export interface SavedNest {
  id: number;
  name: string;
  savedAt: number;
  cfg: NestCfg;
  S: Settings;
  result: OptResult;
  /** Parts list the nest was made from, so loading it restores a consistent state. */
  groups: Group[];
}

/** Deep-enough copy: sheets/items are cloned so later drag-and-drop edits never touch a saved nest. */
export function cloneResult(r: OptResult): OptResult {
  return {
    sheets: r.sheets.map(
      (sh): Sheet => ({ ...sh, items: sh.items.map((it) => ({ ...it })), grid: sh.grid ? new Uint8Array(sh.grid) : undefined }),
    ),
    un: [...r.un],
    skip: [...r.skip],
  };
}

const STEEL_KG_PER_MM3 = 7.85e-6; // 7850 kg/m³

export interface NestMetrics {
  sheets: number;
  parts: number;
  unnested: number;
  sheetAreaM2: number;
  partsAreaM2: number;
  scrapM2: number;
  utilization: number;
  scrapPct: number;
  weightKg: number;
  scrapKg: number;
}

export function nestMetrics(r: OptResult, S: Settings): NestMetrics {
  let sheetArea = 0;
  let partsArea = 0;
  let parts = 0;
  let weight = 0;
  let scrapKg = 0;
  for (const sh of r.sheets) {
    const A = (sh.W ?? S.W) * (sh.H ?? S.H);
    const a = sh.items.reduce((s, it) => s + it.g.area, 0);
    sheetArea += A;
    partsArea += a;
    parts += sh.items.reduce((s, it) => s + (it.g.n || 1), 0);
    if (sh.th > 0) {
      weight += A * sh.th * STEEL_KG_PER_MM3;
      scrapKg += (A - a) * sh.th * STEEL_KG_PER_MM3;
    }
  }
  const scrap = Math.max(0, sheetArea - partsArea);
  return {
    sheets: r.sheets.length,
    parts,
    unnested: r.un.length,
    sheetAreaM2: sheetArea / 1e6,
    partsAreaM2: partsArea / 1e6,
    scrapM2: scrap / 1e6,
    utilization: sheetArea ? (100 * partsArea) / sheetArea : 0,
    scrapPct: sheetArea ? (100 * scrap) / sheetArea : 0,
    weightKg: weight,
    scrapKg,
  };
}

const ROT_LABEL: Record<string, string> = { "0": "None", "1": "0°/180°", "2": "90° steps", "3": "45° steps", "4": "15° steps" };

interface Row {
  label: string;
  get: (n: SavedNest, m: NestMetrics) => string;
  /** numeric value + direction used to highlight the best column; omitted = no highlight. */
  num?: (m: NestMetrics) => number;
  better?: "high" | "low";
}

const ROWS: Row[] = [
  { label: "Sheets used", get: (_, m) => String(m.sheets), num: (m) => m.sheets, better: "low" },
  { label: "Utilization", get: (_, m) => `${m.utilization.toFixed(1)}%`, num: (m) => m.utilization, better: "high" },
  { label: "Scrap", get: (_, m) => `${m.scrapPct.toFixed(1)}%`, num: (m) => m.scrapPct, better: "low" },
  { label: "Sheet area (m²)", get: (_, m) => m.sheetAreaM2.toFixed(2), num: (m) => m.sheetAreaM2, better: "low" },
  { label: "Parts area (m²)", get: (_, m) => m.partsAreaM2.toFixed(2) },
  { label: "Scrap area (m²)", get: (_, m) => m.scrapM2.toFixed(2), num: (m) => m.scrapM2, better: "low" },
  { label: "Material weight (kg)", get: (_, m) => (m.weightKg ? m.weightKg.toFixed(1) : "—"), num: (m) => m.weightKg || Infinity, better: "low" },
  { label: "Scrap weight (kg)", get: (_, m) => (m.scrapKg ? m.scrapKg.toFixed(1) : "—"), num: (m) => m.scrapKg || Infinity, better: "low" },
  { label: "Parts nested", get: (_, m) => String(m.parts), num: (m) => m.parts, better: "high" },
  { label: "Parts not nested", get: (_, m) => String(m.unnested), num: (m) => m.unnested, better: "low" },
  { label: "Sheet size (mm)", get: (n) => `${n.cfg.W} × ${n.cfg.H}` },
  { label: "Margin / spacing (mm)", get: (n) => `${n.cfg.mg} / ${n.cfg.gp}` },
  { label: "Rotation", get: (n) => ROT_LABEL[n.cfg.ro] ?? n.cfg.ro },
  { label: "Pair triangles / common cut", get: (n) => `${n.cfg.pair ? "yes" : "no"} / ${n.cfg.common ? "yes" : "no"}` },
];

function bestIndexes(vals: number[], better: "high" | "low"): Set<number> {
  const finite = vals.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return new Set();
  const target = better === "high" ? Math.max(...finite) : Math.min(...finite);
  if (finite.every((v) => Math.abs(v - target) < 1e-9)) return new Set(); // all equal: nothing to highlight
  return new Set(vals.map((v, i) => (Math.abs(v - target) < 1e-9 ? i : -1)).filter((i) => i >= 0));
}

interface Props {
  nests: SavedNest[];
  activeId: number | null;
  onLoad: (n: SavedNest) => void;
  onDelete: (id: number) => void;
  onRename: (id: number, name: string) => void;
}

export function SavedNestsCard({ nests, activeId, onLoad, onDelete, onRename }: Props) {
  const [picked, setPicked] = React.useState<Set<number>>(new Set());
  const [editing, setEditing] = React.useState<{ id: number; name: string } | null>(null);
  const metrics = React.useMemo(() => new Map(nests.map((n) => [n.id, nestMetrics(n.result, n.S)])), [nests]);

  // forget selections of nests that were deleted
  React.useEffect(() => {
    setPicked((p) => {
      const ids = new Set(nests.map((n) => n.id));
      const next = new Set([...p].filter((id) => ids.has(id)));
      return next.size === p.size ? p : next;
    });
  }, [nests]);

  const toggle = (id: number) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const chosen = nests.filter((n) => picked.has(n.id));
  const commitRename = () => {
    if (editing && editing.name.trim()) onRename(editing.id, editing.name.trim());
    setEditing(null);
  };

  return (
    <Card className="p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Saved nests ({nests.length})</h3>
        {nests.length > 1 && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="h-7" onClick={() => setPicked(new Set(nests.map((n) => n.id)))}>
              Select all
            </Button>
            <Button variant="ghost" size="sm" className="h-7" disabled={!picked.size} onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          </div>
        )}
      </div>
      {!nests.length ? (
        <p className="text-sm text-muted-foreground">
          Press &quot;Save this nest&quot; under the result to keep it, change the settings or the parts, optimize again and compare. There is no limit
          on how many you can save (they are kept until you leave this page).
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="p-1" />
                  <th className="p-1">Name</th>
                  <th className="p-1">Sheets</th>
                  <th className="p-1">Utilization</th>
                  <th className="p-1">Scrap m²</th>
                  <th className="p-1" />
                </tr>
              </thead>
              <tbody>
                {nests.map((n) => {
                  const m = metrics.get(n.id)!;
                  const isEditing = editing?.id === n.id;
                  return (
                    <tr key={n.id} className={`border-t border-border ${activeId === n.id ? "bg-secondary/60" : ""}`}>
                      <td className="p-1">
                        <Checkbox checked={picked.has(n.id)} onCheckedChange={() => toggle(n.id)} aria-label={`Compare ${n.name}`} />
                      </td>
                      <td className="p-1">
                        {isEditing ? (
                          <span className="flex items-center gap-1">
                            <Input
                              autoFocus className="h-7 w-40" value={editing.name}
                              onChange={(e) => setEditing({ id: n.id, name: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") commitRename();
                                if (e.key === "Escape") setEditing(null);
                              }}
                            />
                            <Button variant="ghost" size="sm" className="h-7" onClick={commitRename}><Check /></Button>
                            <Button variant="ghost" size="sm" className="h-7" onClick={() => setEditing(null)}><X /></Button>
                          </span>
                        ) : (
                          <span className="font-semibold text-foreground">
                            {n.name}
                            {activeId === n.id && <span className="ml-1 font-normal text-muted-foreground">(open)</span>}
                          </span>
                        )}
                      </td>
                      <td className="p-1">{m.sheets}</td>
                      <td className="p-1">{m.utilization.toFixed(1)}%</td>
                      <td className="p-1">{m.scrapM2.toFixed(2)}</td>
                      <td className="whitespace-nowrap p-1 text-right">
                        <Button variant="ghost" size="sm" className="h-7" title="Show this nest again (restores its settings and parts)" onClick={() => onLoad(n)}>
                          <FolderOpen /> Open
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7" title="Rename" onClick={() => setEditing({ id: n.id, name: n.name })}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-destructive" title="Delete this saved nest" onClick={() => onDelete(n.id)}>
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {chosen.length >= 2 ? (
            <div className="mt-4 overflow-x-auto border-t border-border pt-3">
              <div className="mb-2 text-xs font-semibold text-foreground">Comparison ({chosen.length} nests)</div>
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="p-1" />
                    {chosen.map((n) => (
                      <th key={n.id} className="p-1">{n.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((row) => {
                    const ms = chosen.map((n) => metrics.get(n.id)!);
                    const best = row.num && row.better ? bestIndexes(ms.map(row.num), row.better) : new Set<number>();
                    return (
                      <tr key={row.label} className="border-t border-border">
                        <td className="p-1 text-muted-foreground">{row.label}</td>
                        {chosen.map((n, i) => (
                          <td key={n.id} className={`p-1 ${best.has(i) ? "font-semibold text-emerald-600" : ""}`}>
                            {row.get(n, ms[i])}
                            {best.has(i) && " ✓"}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-muted-foreground">Green ✓ = best value in that row. Fewer sheets, less scrap and no un-nested parts are better.</p>
            </div>
          ) : (
            nests.length > 1 && <p className="mt-2 text-xs text-muted-foreground">Tick two or more nests to compare them side by side.</p>
          )}
        </>
      )}
    </Card>
  );
}