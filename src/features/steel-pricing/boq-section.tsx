"use client";
import * as React from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CalcBreakdown, SpecialBreakdown, type BreakdownEditor } from "./item-breakdown";
import { SectionTitle } from "./pricing-inputs";
import { MATERIAL_ORDER, SECTION_LABEL } from "./steel-pricing-data";
import { applyOverride, componentOn, fmt, fmt2, pct } from "./steel-pricing-engine";
import type { BoqItem, BoqResult, CustomLine, InstallKey, ItemOverride, MaterialTable, Overrides, PaintBasis, Profile, RateBook } from "./types";
import { PROFILES } from "./types";

type Filter = "all" | "supply" | "install";
const HEAD = ["Item", "Description", "Material", "Unit", "Quantity", "Unit price", "Total (EGP)", "Profit %", "Scope", "Install profile", "Painting price"];

export function BoqSection({ items, result, rates, materials, overrides, onOverride, onRates }: {
  items: BoqItem[]; result: BoqResult; rates: RateBook; materials: MaterialTable; overrides: Overrides;
  onOverride: (no: string, patch: ItemOverride | null) => void;
  onRates: (fn: (r: RateBook) => RateBook) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<Filter>("all");
  const [open, setOpen] = React.useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const visible = items.filter((i) => (filter === "all" || i.sec === filter) && (!q || i.no.toLowerCase().includes(q) || i.desc.toLowerCase().includes(q)));
  const groups: { sec: "supply" | "install"; sub: string; rows: BoqItem[] }[] = [];
  for (const it of visible) {
    const g = groups.find((x) => x.sec === it.sec && x.sub === it.sub);
    if (g) g.rows.push(it); else groups.push({ sec: it.sec, sub: it.sub, rows: [it] });
  }
  const secTotal = (sec: "supply" | "install") => items.filter((i) => i.sec === sec).reduce((s, i) => s + result.items[i.no].finalPrice, 0);

  const setQty = (no: string, v: string) => { const n = Number(v); if (isFinite(n) && n >= 0) onOverride(no, { qty: n }); };

  return (
    <section>
      <SectionTitle n={3} title={`Full BOQ (${items.length} items)`} hint="Edit quantity, material or installation profile on any row. Click a row to see how its price is built — tick or untick any component, or add your own line (e.g. Hot rolled)." />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search by item no. or description…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="supply">Supply</SelectItem>
            <SelectItem value="install">Dismantle &amp; install</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="overflow-x-auto">
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead className="sticky top-0 bg-muted/60 text-[11px] text-muted-foreground">
            <tr>{HEAD.map((h, i) => <th key={h} className={cn("px-2 py-2 font-medium", i >= 4 && i <= 7 ? "text-right" : "text-left")}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {(["supply", "install"] as const).map((sec) => {
              const secGroups = groups.filter((g) => g.sec === sec);
              if (secGroups.length === 0) return null;
              return (
                <React.Fragment key={sec}>
                  <tr className="bg-primary/10"><td colSpan={6} className="px-2 py-2 text-xs font-semibold text-primary">{SECTION_LABEL[sec]}</td>
                    <td className="px-2 py-2 text-right font-mono text-xs font-semibold text-primary">{fmt(secTotal(sec))}</td><td colSpan={4} /></tr>
                  {secGroups.map((g) => (
                    <React.Fragment key={g.sub}>
                      <tr className="bg-muted/30"><td colSpan={6} className="px-2 py-1.5 text-[11px] font-semibold">{g.sub}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-[11px] font-semibold">{fmt(g.rows.reduce((s, r) => s + result.items[r.no].finalPrice, 0))}</td><td colSpan={4} /></tr>
                      {g.rows.map((base) => {
                        const it = applyOverride(base, overrides[base.no]);
                        const r = result.items[it.no];
                        const isOpen = open === it.no;
                        const edited = !!overrides[it.no];
                        return (
                          <React.Fragment key={it.no}>
                            <tr className={cn("cursor-pointer border-t border-border hover:bg-muted/40", isOpen && "bg-muted/40")} onClick={() => setOpen(isOpen ? null : it.no)}>
                              <td className="whitespace-nowrap px-2 py-1.5 font-mono font-medium">
                                <span className="inline-flex items-center gap-1">{isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}{it.no}{edited && <span className="h-1.5 w-1.5 rounded-full bg-primary" title="Edited from the workbook default" />}</span>
                              </td>
                              <td className="max-w-[300px] px-2 py-1.5">
                                <div className="truncate" title={it.desc}>{it.desc}</div>
                                <div className="mt-0.5 flex gap-1">
                                  {it.mode === "pricedLike" && <Badge variant="warning" className="px-1.5 py-0 text-[10px]">Priced like {it.like.src}{it.like.mult !== 1 ? ` ×${it.like.mult.toFixed(2)}` : ""}</Badge>}
                                  {it.mode === "fixed" && <Badge variant="default" className="px-1.5 py-0 text-[10px]">Fixed price</Badge>}
                                  {it.mode === "unpriced" && <Badge variant="destructive" className="px-1.5 py-0 text-[10px]">Unpriced</Badge>}
                                </div>
                              </td>
                              <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                {it.mode === "calc" && it.spec.matRow ? (
                                  <Select value={String(it.spec.matRow)} onValueChange={(v) => onOverride(it.no, { matRow: Number(v) })}>
                                    <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>{MATERIAL_ORDER.map((row) => <SelectItem key={row} value={String(row)}>{materials[row].label}</SelectItem>)}</SelectContent>
                                  </Select>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-2 py-1.5 text-muted-foreground">{it.unit}</td>
                              <td className="px-2 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                                <input value={String(it.qty)} onChange={(e) => setQty(it.no, e.target.value)} inputMode="decimal" className="h-7 w-20 rounded-md border border-input bg-card px-2 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring" />
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono">{r.finalPrice > 0 || it.mode === "fixed" ? fmt2(r.unitPrice) : "—"}</td>
                              <td className="px-2 py-1.5 text-right font-mono font-semibold">{fmt(r.finalPrice)}</td>
                              <td className="px-2 py-1.5 text-right font-mono">{pct(r.profitPct)}</td>
                              <td className="px-2 py-1.5"><Badge variant={it.scope === "Supply" ? "success" : "warning"} className="px-1.5 py-0 text-[10px]">{it.scope === "Supply" ? "Supply" : "Install"}</Badge></td>
                              <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                {it.mode === "calc" && Object.keys(it.spec.install).length > 0 ? (
                                  <Select value={profileValue(base, it)} onValueChange={(v) => setAllProfiles(base, it, v, onOverride, overrides[base.no])}>
                                    <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="default">Workbook</SelectItem>
                                      {PROFILES.map((p) => <SelectItem key={p} value={p}>Profile {p}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                              <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                                {it.mode === "calc" && (it.spec.painting || it.spec.paintingRate) ? (
                                  <PaintBasisControl item={it} onOverride={onOverride} override={overrides[it.no]} rates={rates} />
                                ) : <span className="text-muted-foreground">—</span>}
                              </td>
                            </tr>
                            {isOpen && (
                              <tr className="border-t border-border bg-background">
                                <td colSpan={11} className="px-4 py-4">
                                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <div className="text-sm font-semibold">{it.no} — {it.desc}</div>
                                      <div className="text-xs text-muted-foreground">{it.mode === "calc" && it.spec.matRow ? `Material: ${materials[it.spec.matRow].label} · ` : ""}Scope: {it.scope === "Supply" ? "Supply" : "Dismantle & install"} · Quantity: {fmt2(it.qty)} {it.unit}</div>
                                    </div>
                                    {edited && <button className="text-xs text-primary hover:underline" onClick={() => onOverride(it.no, null)}>Reset to workbook values</button>}
                                  </div>
                                  {it.mode === "calc" && result.items[it.no].mode === "calc" ? (
                                    <CalcBreakdown item={it} r={result.items[it.no] as Extract<typeof r, { mode: "calc" }>} R={rates} mats={materials}
                                      editor={makeEditor(base, overrides[it.no], onOverride, onRates)} />
                                  ) : <SpecialBreakdown item={it} r={r} />}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            })}
            {visible.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">No items match.</td></tr>}
          </tbody>
        </table>
      </Card>
    </section>
  );
}

/** "default" if no per-item profile override; a letter if every overridden activity uses the same profile. */
function profileValue(base: BoqItem, cur: BoqItem): string {
  if (base.mode !== "calc" || cur.mode !== "calc") return "default";
  // Activities ticked on by the user are not in the workbook spec, so they count as profile A.
  const diffs = (Object.keys(cur.spec.install) as InstallKey[]).filter((k) => cur.spec.install[k]!.p !== (base.spec.install[k]?.p ?? "A"));
  if (diffs.length === 0) return "default";
  const all = Object.values(cur.spec.install).map((l) => l!.p);
  return all.every((p) => p === all[0]) ? all[0] : "default";
}

function setAllProfiles(base: BoqItem, cur: BoqItem, v: string, onOverride: (no: string, patch: ItemOverride | null) => void, existing?: ItemOverride) {
  if (base.mode !== "calc" || cur.mode !== "calc") return;
  const rest: ItemOverride = { ...existing };
  if (v === "default") delete rest.install;
  else rest.install = Object.fromEntries((Object.keys(cur.spec.install) as InstallKey[]).map((k) => [k, v as Profile]));
  onOverride(base.no, Object.keys(rest).length ? { ...rest, install: rest.install ?? undefined } : null);
}

/** Wires the breakdown's checkboxes and "Add line" rows to this item's override. */
function makeEditor(base: BoqItem, override: ItemOverride | undefined, onOverride: (no: string, patch: ItemOverride | null) => void, onRates: (fn: (r: RateBook) => RateBook) => void): BreakdownEditor {
  const custom = override?.custom ?? [];
  const setCustom = (list: CustomLine[]) => onOverride(base.no, { custom: list });
  return {
    custom,
    onRates,
    selectRate: (id, optionId) => {
      if (id.startsWith("install.")) onOverride(base.no, { install: { ...override?.install, [id.slice(8) as InstallKey]: optionId } });
      else onOverride(base.no, { rates: { ...override?.rates, [id]: optionId } });
    },
    toggle: (id, on) => {
      if (base.mode !== "calc") return;
      const toggles = { ...override?.toggles };
      // Ticking a component back to the workbook default just drops the override.
      if (on === componentOn(base.spec, id)) delete toggles[id]; else toggles[id] = on;
      onOverride(base.no, { toggles });
    },
    addCustom: (line) => setCustom([...custom, { ...line, id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, enabled: true }]),
    updateCustom: (id, patch) => setCustom(custom.map((c) => (c.id === id ? { ...c, ...patch } : c))),
    removeCustom: (id) => setCustom(custom.filter((c) => c.id !== id)),
  };
}

/** Per-item choice: price the painting per ton of steel, or per m² when the painted area is known. */
function PaintBasisControl({ item, override, onOverride, rates }: {
  item: Extract<BoqItem, { mode: "calc" }>; override?: ItemOverride; rates: RateBook;
  onOverride: (no: string, patch: ItemOverride | null) => void;
}) {
  const basis: PaintBasis = item.spec.paintBasis ?? "ton";
  const rateM2 = item.spec.painting ? rates.paintingArea[item.spec.painting] ?? 0 : 0;
  const area = item.spec.paintArea ?? 0;
  const missing = basis === "area" && (rateM2 <= 0 || area <= 0);
  return (
    <div className="flex items-center gap-1">
      <Select value={basis} onValueChange={(v) => onOverride(item.no, { ...override, paintBasis: v as PaintBasis })}>
        <SelectTrigger className="h-7 w-24 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="ton">Per ton</SelectItem>
          <SelectItem value="area">Per m²</SelectItem>
        </SelectContent>
      </Select>
      {basis === "area" && (
        <span className="relative inline-flex items-center">
          <input value={String(area || "")} placeholder="area" inputMode="decimal"
            onChange={(e) => { const n = Number(e.target.value); if (isFinite(n) && n >= 0) onOverride(item.no, { ...override, paintBasis: "area", paintArea: n }); }}
            className={cn("h-7 w-20 rounded-md border bg-card px-2 pr-6 text-right font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring", missing ? "border-destructive" : "border-input")} />
          <span className="pointer-events-none absolute right-1.5 text-[10px] text-muted-foreground">m²</span>
        </span>
      )}
      {missing && <span className="text-[10px] text-destructive" title="Enter the painted area and the per-m² painting price in Pricing setup">{rateM2 <= 0 ? "no m² price" : "no area"}</span>}
    </div>
  );
}
