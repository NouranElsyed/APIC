"use client";
import * as React from "react";
import { Layers, Wrench, Truck, Receipt } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RateInput, SectionTitle } from "./pricing-inputs";
import { INSTALL_LABEL, MATERIAL_ORDER } from "./steel-pricing-data";
import type { InstallKey, MaterialTable, Profile, ProfileRates, RateBook } from "./types";
import { INSTALL_KEYS, PROFILES } from "./types";

type Tab = "material" | "fabrication" | "installation" | "additional";
const TABS: { key: Tab; title: string; sub: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "material", title: "Material", sub: "Prices, scrap, welding & painting rates", icon: Layers },
  { key: "fabrication", title: "Fabrication rates", sub: "Cutting, NDT, indirect, margins", icon: Wrench },
  { key: "installation", title: "Installation profiles", sub: "Activity rates for Profiles A – E", icon: Truck },
  { key: "additional", title: "Additional, tax & insurance", sub: "Mob/demob, certificates, tax", icon: Receipt },
];

// Rate-card rows 11–15 hold a complete rate set (price, scrap, welding, painting) — they line up with profiles E…A.
const SET_PROFILE: Record<number, Profile> = { 15: "A", 14: "B", 13: "C", 12: "D", 11: "E" };

export function PricingSetup({ rates, materials, onRates, onMaterialPrice }: {
  rates: RateBook;
  materials: MaterialTable;
  onRates: (fn: (r: RateBook) => RateBook) => void;
  onMaterialPrice: (row: number, price: number) => void;
}) {
  const [tab, setTab] = React.useState<Tab>("material");
  const setProfile = (group: (r: RateBook) => ProfileRates, p: Profile, v: number) =>
    onRates((r) => { const n = structuredClone(r); group(n)[p] = v; return n; });
  const setInstall = (k: InstallKey, p: Profile, v: number) =>
    onRates((r) => { const n = structuredClone(r); n.install[k][p] = v; return n; });

  return (
    <section>
      <SectionTitle n={1} title="Pricing setup" hint="Every rate the price is built from, grouped by stage. Edit a value and every item, subtotal and the grand total update immediately. Changes are saved in this browser." />
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
              tab === t.key ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted/50")}>
            <t.icon className={cn("mt-0.5 h-4 w-4 shrink-0", tab === t.key ? "text-primary" : "text-muted-foreground")} />
            <span><span className="block text-xs font-semibold">{t.title}</span><span className="block text-[11px] text-muted-foreground">{t.sub}</span></span>
          </button>
        ))}
      </div>

      <Card className="overflow-x-auto p-4">
        {tab === "material" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
              <label className="flex items-center gap-2">Material handling <RateInput value={rates.handling.A} scale={100} suffix="%" className="w-20" onChange={(v) => setProfile((r) => r.handling, "A", v)} /></label>
              <label className="flex items-center gap-2">Accessories (profile A) <RateInput value={rates.accessories.A} scale={100} suffix="%" className="w-20" onChange={(v) => setProfile((r) => r.accessories, "A", v)} /></label>
              <label className="flex items-center gap-2">Accessories (profile B) <RateInput value={rates.accessories.B} scale={100} suffix="%" className="w-20" onChange={(v) => setProfile((r) => r.accessories, "B", v)} /></label>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px]">Material</TableHead><TableHead className="text-[11px]">Unit</TableHead>
                  <TableHead className="text-right text-[11px]">Material price (EGP)</TableHead>
                  <TableHead className="text-right text-[11px]">Scrap %</TableHead>
                  <TableHead className="text-right text-[11px]">Welding rate (EGP/t)</TableHead>
                  <TableHead className="text-right text-[11px]">Painting per ton (EGP/t)</TableHead>
                  <TableHead className="text-right text-[11px]">Painting per m² (EGP/m²)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {MATERIAL_ORDER.map((row) => {
                  const p = SET_PROFILE[row];
                  const m = materials[row];
                  return (
                    <TableRow key={row}>
                      <TableCell className="py-1 text-xs font-medium">{m.label}{p && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">rate set {p}</span>}</TableCell>
                      <TableCell className="py-1 text-xs text-muted-foreground">{m.unit}</TableCell>
                      <TableCell className="py-1 text-right"><RateInput value={m.price} decimals={2} onChange={(v) => onMaterialPrice(row, v)} className="w-28" /></TableCell>
                      <TableCell className="py-1 text-right">{p && p !== "E" ? <RateInput value={rates.scrap[p]} scale={100} suffix="%" className="w-20" onChange={(v) => setProfile((r) => r.scrap, p, v)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="py-1 text-right">{p ? <RateInput value={rates.welding[p]} decimals={0} className="w-24" onChange={(v) => setProfile((r) => r.welding, p, v)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="py-1 text-right">{p ? <RateInput value={rates.painting[p]} decimals={0} className="w-24" onChange={(v) => setProfile((r) => r.painting, p, v)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="py-1 text-right">{p ? <RateInput value={rates.paintingArea[p]} decimals={2} placeholder="enter" className="w-24" onChange={(v) => setProfile((r) => r.paintingArea, p, v)} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="text-[11px] text-muted-foreground">Welding is per ton. Painting has two prices: per ton (used when the painted area is unknown — the workbook rate) and per m² (used when you know the area). The per-m² price is not in the workbook, so enter it yourself; you choose per ton or per m² for each item in the BOQ. Materials without a rate set are supplied without in-house welding/painting; each BOQ item keeps the scrap, welding and painting profile the workbook assigns to it.</p>
          </div>
        )}

        {tab === "fabrication" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold">Fabrication rates</h4>
              <Table>
                <TableHeader><TableRow><TableHead className="text-[11px]">Activity</TableHead>{PROFILES.map((p) => <TableHead key={p} className="text-right text-[11px]">{p}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  <ProfileRow label="Cutting (EGP/t)" rates={rates.cutting} decimals={0} onChange={(p, v) => setProfile((r) => r.cutting, p, v)} only={["A"]} />
                  <ProfileRow label="Fit-up & welding (EGP/t)" rates={rates.welding} decimals={0} onChange={(p, v) => setProfile((r) => r.welding, p, v)} />
                  <ProfileRow label="Painting per ton (EGP/t)" rates={rates.painting} decimals={0} onChange={(p, v) => setProfile((r) => r.painting, p, v)} />
                  <ProfileRow label="Painting per m² (EGP/m²)" rates={rates.paintingArea} decimals={2} onChange={(p, v) => setProfile((r) => r.paintingArea, p, v)} />
                  <ProfileRow label="NDT (% of fabrication)" rates={rates.ndt} scale={100} suffix="%" onChange={(p, v) => setProfile((r) => r.ndt, p, v)} only={["A"]} />
                  <ProfileRow label="Fabrication indirect (%)" rates={rates.fabIndirect} scale={100} suffix="%" onChange={(p, v) => setProfile((r) => r.fabIndirect, p, v)} only={["A", "B"]} />
                </TableBody>
              </Table>
              <p className="text-[11px] text-muted-foreground">Rolling exists as a column in the workbook but is not priced for any item (0), so it is not charged here.</p>
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold">Supply &amp; fabrication margins (multipliers)</h4>
              <Table>
                <TableBody>
                  {([["material", "Material"], ["fabrication", "Fabrication (cutting, fit-up & welding)"], ["ndt", "NDT"], ["painting", "Painting"]] as const).map(([k, label]) => (
                    <TableRow key={k}>
                      <TableCell className="py-1 text-xs">{label}</TableCell>
                      <TableCell className="py-1 text-right"><RateInput value={rates.margins[k]} decimals={3} suffix="×" className="w-24" onChange={(v) => onRates((r) => ({ ...r, margins: { ...r.margins, [k]: v } }))} /></TableCell>
                      <TableCell className="py-1 text-right text-[11px] text-muted-foreground">{`+${((rates.margins[k] - 1) * 100).toFixed(1)}% markup`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        {tab === "installation" && (
          <div className="space-y-2">
            <Table>
              <TableHeader><TableRow><TableHead className="text-[11px]">Installation activity (EGP / ton)</TableHead>{PROFILES.map((p) => <TableHead key={p} className="text-right text-[11px]">Profile {p}</TableHead>)}</TableRow></TableHeader>
              <TableBody>
                {INSTALL_KEYS.map((k) => (
                  <ProfileRow key={k} label={INSTALL_LABEL[k]} rates={rates.install[k]} decimals={0} highlightVsA onChange={(p, v) => setInstall(k, p, v)} />
                ))}
                <ProfileRow label="Installation indirect (%)" rates={rates.installIndirect} scale={100} suffix="%" onChange={(p, v) => setProfile((r) => r.installIndirect, p, v)} only={["A", "B"]} />
                <ProfileRow label="Installation margin (×)" rates={rates.installMargin} decimals={3} onChange={(p, v) => setProfile((r) => r.installMargin, p, v)} only={["A", "B", "C"]} />
              </TableBody>
            </Table>
            <p className="text-[11px] text-muted-foreground">Profile A is the workbook&apos;s default rate for each activity; Profiles B–E are the alternatives it uses for specific items (the workbook does not name them). Highlighted values differ from Profile A. Choose a profile per item in the BOQ. A dash means the workbook defines no rate for that profile (charged as 0).</p>
          </div>
        )}

        {tab === "additional" && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h4 className="text-xs font-semibold">Additional costs (% of supply + installation sale price)</h4>
              <Table><TableBody>
                {([["mobDemob", "Mobilization / demobilization"], ["heightFactor", "Height factor"], ["thirdParty", "Third-party certificate"], ["commissioning", "Commissioning"]] as const).map(([k, label]) => (
                  <TableRow key={k}><TableCell className="py-1 text-xs">{label}</TableCell>
                    <TableCell className="py-1 text-right"><RateInput value={rates[k]} scale={100} suffix="%" decimals={3} className="w-24" onChange={(v) => onRates((r) => ({ ...r, [k]: v }))} /></TableCell></TableRow>
                ))}
              </TableBody></Table>
              <p className="text-[11px] text-muted-foreground">Applied to site (dismantle / install) items only, per the workbook.</p>
            </div>
            <div className="space-y-2">
              <h4 className="text-xs font-semibold">Tax &amp; social insurance</h4>
              <Table>
                <TableHeader><TableRow><TableHead className="text-[11px]">Divisor</TableHead>{(["A", "B"] as const).map((p) => <TableHead key={p} className="text-right text-[11px]">Profile {p}</TableHead>)}</TableRow></TableHeader>
                <TableBody>
                  <ProfileRow label="Tax (price ÷ divisor)" rates={rates.tax} decimals={4} only={["A", "B"]} onChange={(p, v) => setProfile((r) => r.tax, p, v)} />
                  <ProfileRow label="Social insurance (price ÷ divisor)" rates={rates.insurance} decimals={4} only={["A", "B"]} onChange={(p, v) => setProfile((r) => r.insurance, p, v)} />
                </TableBody>
              </Table>
              <p className="text-[11px] text-muted-foreground">The workbook grosses the price up by dividing (0.99 ⇒ +1.01% tax, 0.9505 ⇒ +5.21% insurance). Supply items use tax A / insurance B; site items use tax B / insurance A.</p>
            </div>
          </div>
        )}
      </Card>
    </section>
  );
}

function ProfileRow({ label, rates, onChange, decimals = 2, scale = 1, suffix, only, highlightVsA }: {
  label: string; rates: ProfileRates; onChange: (p: Profile, v: number) => void;
  decimals?: number; scale?: number; suffix?: string; only?: Profile[]; highlightVsA?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="py-1 text-xs">{label}</TableCell>
      {PROFILES.map((p) => {
        const editable = !only || only.includes(p);
        const differs = highlightVsA && p !== "A" && rates[p] !== undefined && rates[p] !== rates.A;
        return (
          <TableCell key={p} className="py-1 text-right">
            {editable ? <RateInput value={rates[p]} decimals={decimals} scale={scale} suffix={suffix} highlight={differs} className="w-24" onChange={(v) => onChange(p, v)} /> : <span className="text-xs text-muted-foreground">—</span>}
          </TableCell>
        );
      })}
    </TableRow>
  );
}
