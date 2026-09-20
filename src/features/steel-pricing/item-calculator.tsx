"use client";
import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CalcBreakdown, FinalCard } from "./item-breakdown";
import { SectionTitle } from "./pricing-inputs";
import { MATERIAL_ORDER } from "./steel-pricing-data";
import { calcItem, fmt } from "./steel-pricing-engine";
import type { BoqItem, InstallKey, MaterialTable, PaintBasis, PricingScope, Profile, RateBook } from "./types";
import { INSTALL_KEYS, PROFILES } from "./types";

// Material rows 11–15 carry a full rate set (scrap / welding / painting) — same letter mapping the workbook uses.
const SET_PROFILE: Record<number, Profile> = { 15: "A", 14: "B", 13: "C", 12: "D", 11: "E" };
// Tons per unit for area / piece-priced materials (from the workbook's unit-weight column).
const UNIT_WEIGHT: Record<number, number> = { 9: 0.0079, 8: 0.03, 7: 0.01, 6: 0.008, 1: 0.04 };
const SUPPLY_INSTALL: InstallKey[] = ["transport", "handling", "packing"];

/** Builds a "typical" item from the workbook's default rate sets for the chosen material, scope and profile. */
function typicalItem(matRow: number, scope: "Supply" | "Site Activity", profile: Profile, qty: number, unit: string): Extract<BoqItem, { mode: "calc" }> {
  const set = SET_PROFILE[matRow];
  const wt = UNIT_WEIGHT[matRow];
  const keys = scope === "Supply" ? SUPPLY_INSTALL : INSTALL_KEYS;
  const install: Partial<Record<InstallKey, { p: Profile; k: number; wt: boolean }>> = {};
  for (const k of keys) install[k] = { p: profile, k: 1, wt: wt !== undefined };
  const isSite = scope === "Site Activity";
  return {
    no: "calc", sec: isSite ? "install" : "supply", sub: "", scope, desc: "Typical item", grade: "", unit, qty, mode: "calc",
    spec: {
      unitWt: wt ?? 0, matRow, handling: true, scrap: set && set !== "E" ? set : "A", accessories: null,
      cutting: null, welding: set ?? null, painting: set ?? null, ndt: !!set, fabIndirect: "A",
      install, installIndirect: profile === "B" ? "B" : "A", installMargin: profile === "B" || profile === "C" ? profile : "A",
      mob: isSite, height: isSite, thirdParty: isSite, commissioning: isSite,
      tax: isSite ? "B" : "A", insurance: isSite ? "A" : "B",
    },
  };
}

export function ItemCalculator({ rates, materials }: { rates: RateBook; materials: MaterialTable }) {
  const [matRow, setMatRow] = React.useState(15);
  const [scope, setScope] = React.useState<PricingScope>("Supply");
  const [profile, setProfile] = React.useState<Profile>("A");
  const [qty, setQty] = React.useState("10");
  const [paintBasis, setPaintBasis] = React.useState<PaintBasis>("ton");
  const [paintArea, setPaintArea] = React.useState("");
  const unit = materials[matRow]?.unit ?? "MT";
  const item = React.useMemo(() => {
    const it = typicalItem(matRow, scope, profile, Number(qty) || 0, unit);
    if (SET_PROFILE[matRow]) { it.spec.paintBasis = paintBasis; it.spec.paintArea = Number(paintArea) || 0; }
    return it;
  }, [matRow, scope, profile, qty, unit, paintBasis, paintArea]);
  const r = React.useMemo(() => calcItem(item, rates, materials), [item, rates, materials]);
  const [showDetail, setShowDetail] = React.useState(false);

  const stages = [
    { n: 1, title: "Material", value: r.materialCost, tone: "border-blue-200 bg-blue-50 dark:bg-blue-950/30" },
    { n: 2, title: "Fabrication", value: r.totalFabricationCost - r.materialCost + r.fabIndirect, tone: "border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30" },
    { n: 3, title: "Installation", value: r.installDirect + r.installIndirect, tone: "border-orange-200 bg-orange-50 dark:bg-orange-950/30" },
    { n: 4, title: "Additional", value: r.mobDemob + r.heightFactor + r.thirdParty + r.commissioning, tone: "border-violet-200 bg-violet-50 dark:bg-violet-950/30" },
    { n: 5, title: "Tax & insurance", value: r.tax + r.insurance, tone: "border-rose-200 bg-rose-50 dark:bg-rose-950/30" },
  ];

  return (
    <section>
      <SectionTitle n={2} title="Item pricing calculator" hint="Price a typical item from the workbook's default rate sets. Each stage below is a real result of the same engine that prices the BOQ. Costs are shown per stage; margins are added to reach the final price." />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="space-y-3 p-4">
          <h4 className="text-xs font-semibold">Item inputs</h4>
          <div className="space-y-1"><Label className="text-[11px]">Material</Label>
            <Select value={String(matRow)} onValueChange={(v) => setMatRow(Number(v))}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{MATERIAL_ORDER.map((row) => <SelectItem key={row} value={String(row)}>{materials[row].label}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1"><Label className="text-[11px]">Scope</Label>
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-0.5">
              {(["Supply", "Site Activity"] as const).map((s) => (
                <button key={s} onClick={() => setScope(s)} className={cn("rounded px-2 py-1 text-xs", scope === s ? "bg-card font-semibold shadow-sm" : "text-muted-foreground")}>{s === "Supply" ? "Supply" : "Dismantle & install"}</button>
              ))}
            </div></div>
          <div className="space-y-1"><Label className="text-[11px]">Installation rate profile</Label>
            <Select value={profile} onValueChange={(v) => setProfile(v as Profile)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{PROFILES.map((p) => <SelectItem key={p} value={p}>Profile {p}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div className="space-y-1"><Label className="text-[11px]">Quantity</Label><Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="h-8 font-mono text-xs" /></div>
            <div className="space-y-1"><Label className="text-[11px]">Unit</Label><div className="flex h-8 items-center rounded-md border border-input bg-muted px-3 text-xs">{unit}</div></div>
          </div>
          {SET_PROFILE[matRow] && (
            <div className="space-y-1"><Label className="text-[11px]">Painting price</Label>
              <div className="flex gap-2">
                <Select value={paintBasis} onValueChange={(v) => setPaintBasis(v as PaintBasis)}>
                  <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ton">Per ton</SelectItem><SelectItem value="area">Per m²</SelectItem></SelectContent>
                </Select>
                {paintBasis === "area" && <Input value={paintArea} onChange={(e) => setPaintArea(e.target.value)} placeholder="Area m²" inputMode="decimal" className="h-8 w-24 font-mono text-xs" />}
              </div>
              {paintBasis === "area" && (rates.paintingArea[SET_PROFILE[matRow]] ?? 0) <= 0 && <p className="text-[11px] text-destructive">Enter the per-m² painting price in Pricing setup.</p>}
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">Supply prices add delivery only (transport, handling, packing); dismantle &amp; install adds every site activity plus mob/demob and certificates.</p>
        </Card>

        <div className="space-y-3">
          <Card className="p-4">
            <h4 className="mb-3 text-xs font-semibold">Price build-up <span className="font-normal text-muted-foreground">(cost per stage)</span></h4>
            <div className="flex flex-col items-stretch gap-2 md:flex-row md:items-center">
              {stages.map((s, i) => (
                <React.Fragment key={s.n}>
                  <div className={cn("flex-1 rounded-lg border p-3", s.tone)}>
                    <div className="text-[11px] text-muted-foreground">{s.n}. {s.title}</div>
                    <div className="font-mono text-sm font-semibold">{fmt(s.value)}</div>
                    <div className="text-[10px] text-muted-foreground">EGP</div>
                  </div>
                  {i < stages.length - 1 && <ArrowRight className="hidden h-4 w-4 shrink-0 text-muted-foreground md:block" />}
                </React.Fragment>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md bg-muted p-2"><div className="text-[10px] text-muted-foreground">Total cost</div><div className="font-mono font-semibold">{fmt(r.totalCost)}</div></div>
              <div className="rounded-md bg-muted p-2"><div className="text-[10px] text-muted-foreground">+ Profit (margins)</div><div className="font-mono font-semibold">{fmt(r.profit)}</div></div>
              <div className="rounded-md bg-muted p-2"><div className="text-[10px] text-muted-foreground">= Final price</div><div className="font-mono font-semibold">{fmt(r.finalPrice)}</div></div>
            </div>
          </Card>
          <FinalCard finalPrice={r.finalPrice} unitPrice={r.unitPrice} totalCost={r.totalCost} profit={r.profit} profitPct={r.profitPct} unit={unit} />
          <button onClick={() => setShowDetail((v) => !v)} className="text-xs font-medium text-primary hover:underline">{showDetail ? "Hide" : "Show"} full calculation</button>
          {showDetail && <Card className="p-4"><CalcBreakdown item={item} r={r} R={rates} mats={materials} /></Card>}
        </div>
      </div>
    </section>
  );
}
