"use client";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { INSTALL_LABEL } from "./steel-pricing-data";
import { fmt, fmt2, pct } from "./steel-pricing-engine";
import type { BoqItem, CalcResult, ItemResult, MaterialTable, RateBook } from "./types";

const PROFILE_HINT = "Rate profile (A is the workbook default)";

function Sub({ n, title, total, totalLabel }: { n: number; title: string; total?: number; totalLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-1">
      <h4 className="text-xs font-semibold">{n}. {title}</h4>
      {total !== undefined && (
        <span className="font-mono text-xs"><span className="mr-2 font-sans text-muted-foreground">{totalLabel}</span><b>{fmt(total)}</b></span>
      )}
    </div>
  );
}

function Row({ label, rate, amount, bold, muted, extra }: { label: string; rate?: React.ReactNode; amount: number; bold?: boolean; muted?: boolean; extra?: React.ReactNode }) {
  return (
    <TableRow className={cn(bold && "bg-muted/40 font-semibold", muted && "text-muted-foreground")}>
      <TableCell className="py-1.5 text-xs">{label}</TableCell>
      {extra !== undefined && <TableCell className="py-1.5 text-xs">{extra}</TableCell>}
      <TableCell className="py-1.5 text-right font-mono text-xs">{rate}</TableCell>
      <TableCell className="py-1.5 text-right font-mono text-xs">{fmt(amount)}</TableCell>
    </TableRow>
  );
}

const pctOf = (f: number) => `${(f * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export function CalcBreakdown({ item, r, R, mats }: { item: Extract<BoqItem, { mode: "calc" }>; r: CalcResult; R: RateBook; mats: MaterialTable }) {
  const s = item.spec;
  const mat = r.matRow ? mats[r.matRow] : null;
  const isSite = item.scope === "Site Activity";
  const supplyOnly = r.supplySalePrice === 0;
  return (
    <div className="space-y-4">
      {/* 1. Material */}
      {r.materialPrice > 0 || r.accessories > 0 || r.scrap > 0 ? (
        <div className="space-y-1.5">
          <Sub n={1} title="Material cost" total={r.materialCost} totalLabel="Material cost" />
          <Table>
            <TableHeader><TableRow><TableHead className="h-7 text-[11px]">Component</TableHead><TableHead className="h-7 text-right text-[11px]">Rate / value</TableHead><TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead></TableRow></TableHeader>
            <TableBody>
              <Row label={`Material price — ${mat?.label ?? "n/a"}`} rate={`${fmt2(r.materialRate)} / ${mat?.unit ?? "unit"}`} amount={r.materialPrice} />
              {s.handling && <Row label="Handling" rate={pctOf(R.handling.A ?? 0)} amount={r.handling} />}
              {(s.scrap || s.scrapLink) && <Row label="Scrap" rate={s.scrapLink ? `${pctOf(R.scrap[s.scrapLink.profile] ?? 0)} of ${s.scrapLink.item} material` : `${pctOf(R.scrap[s.scrap!] ?? 0)} (profile ${s.scrap})`} amount={r.scrap} />}
              {(s.accessories || s.accessoriesLink) && <Row label="Accessories" rate={s.accessoriesLink ? `${pctOf(s.accessoriesLink.k)} of ${s.accessoriesLink.item} material` : `${pctOf(R.accessories[s.accessories!] ?? 0)} (profile ${s.accessories})`} amount={r.accessories} />}
              <Row bold label="Material cost" amount={r.materialCost} />
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">1. Material — no material is supplied for this activity (labour / installation only).</p>
      )}

      {/* 2. Fabrication */}
      {r.totalFabricationCost - r.materialCost > 0 ? (
        <div className="space-y-1.5">
          <Sub n={2} title="Fabrication cost" total={r.totalFabricationCost - r.materialCost + r.fabIndirect} totalLabel="Fabrication cost" />
          <Table>
            <TableHeader><TableRow><TableHead className="h-7 text-[11px]">Component</TableHead><TableHead className="h-7 text-right text-[11px]">Rate</TableHead><TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead></TableRow></TableHeader>
            <TableBody>
              {s.cutting && <Row label="Cutting" rate={fmt(R.cutting[s.cutting] ?? 0)} amount={r.cutting} />}
              {s.welding && <Row label="Fit-up & welding" rate={`${fmt(R.welding[s.welding] ?? 0)} (profile ${s.welding})`} amount={r.welding} />}
              {s.ndt && <Row label="NDT" rate={`${pctOf(R.ndt.A ?? 0)} of fabrication`} amount={r.ndt} />}
              {(s.painting || s.paintingRate) && <Row label="Painting" rate={s.paintingRate ? `${fmt(s.paintingRate)} (item rate)` : `${fmt(R.painting[s.painting!] ?? 0)} (profile ${s.painting})`} amount={r.painting} />}
              {s.fabIndirect && <Row label="Fabrication indirect" rate={`${pctOf(R.fabIndirect[s.fabIndirect] ?? 0)} of (material + fabrication)`} amount={r.fabIndirect} />}
              <Row bold label="Fabrication cost" amount={r.totalFabricationCost - r.materialCost + r.fabIndirect} />
              <Row muted label="Supply & fabrication sale price (with margins)" rate={<span title="Margin multipliers on material, fabrication, NDT and painting">×{R.margins.material} / {R.margins.fabrication} / {R.margins.ndt} / {s.paintingMargin ?? R.margins.painting}</span>} amount={r.supplySalePrice} />
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">2. Fabrication — none for this item.</p>
      )}

      {/* 3. Installation */}
      <div className="space-y-1.5">
        <Sub n={3} title={supplyOnly || !isSite ? "Delivery / installation cost" : "Installation cost"} total={r.installDirect + r.installIndirect} totalLabel="Installation cost" />
        <Table>
          <TableHeader><TableRow>
            <TableHead className="h-7 text-[11px]">Activity</TableHead>
            <TableHead className="h-7 text-[11px]" title={PROFILE_HINT}>Profile</TableHead>
            <TableHead className="h-7 text-right text-[11px]">Rate × qty/weight</TableHead>
            <TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {r.installLines.map((l) => (
              <Row key={l.key} label={INSTALL_LABEL[l.key]} extra={l.profile}
                rate={`${fmt2(l.rate)} × ${fmt2(l.weight * l.factor)}`} amount={l.amount} />
            ))}
            {r.installLines.length === 0 && <TableRow><TableCell colSpan={4} className="py-1.5 text-xs text-muted-foreground">No installation activities.</TableCell></TableRow>}
            <Row bold label="Installation direct" extra="" amount={r.installDirect} />
            <Row label="Installation indirect" extra={s.installIndirect} rate={pctOf(R.installIndirect[s.installIndirect] ?? 0)} amount={r.installIndirect} />
            <Row bold label="Installation sale price" extra={s.installMargin} rate={`(direct + indirect) × ${R.installMargin[s.installMargin] ?? 0}`} amount={r.installSale} />
          </TableBody>
        </Table>
      </div>

      {/* 4. Additional */}
      <div className="space-y-1.5">
        <Sub n={4} title="Additional costs" total={r.mobDemob + r.heightFactor + r.thirdParty + r.commissioning} totalLabel="Additional" />
        <Table>
          <TableHeader><TableRow><TableHead className="h-7 text-[11px]">Cost</TableHead><TableHead className="h-7 text-right text-[11px]">Rate</TableHead><TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead></TableRow></TableHeader>
          <TableBody>
            <Row label="Mobilization / demobilization" rate={s.mob ? pctOf(R.mobDemob) : "not applied"} amount={r.mobDemob} />
            <Row label="Height factor" rate={s.height ? pctOf(R.heightFactor) : "not applied"} amount={r.heightFactor} />
            <Row label="Third-party certificate" rate={s.thirdParty ? pctOf(R.thirdParty) : "not applied"} amount={r.thirdParty} />
            <Row label="Commissioning" rate={s.commissioning ? pctOf(R.commissioning) : "not applied"} amount={r.commissioning} />
          </TableBody>
        </Table>
        <p className="text-[11px] text-muted-foreground">Applied on the supply + installation sale price. Not charged where the workbook leaves them out (e.g. supply-only items).</p>
      </div>

      {/* 5. Tax & insurance */}
      <div className="space-y-1.5">
        <Sub n={5} title="Tax & insurance" total={r.tax + r.insurance} totalLabel="Tax & insurance" />
        <Table>
          <TableHeader><TableRow><TableHead className="h-7 text-[11px]">Component</TableHead><TableHead className="h-7 text-right text-[11px]">Basis</TableHead><TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead></TableRow></TableHeader>
          <TableBody>
            <Row label="Tax" rate={`price ÷ ${R.tax[s.tax] ?? 1} (profile ${s.tax})`} amount={r.tax} />
            <Row label="Social insurance" rate={`price ÷ ${R.insurance[s.insurance] ?? 1} (profile ${s.insurance})`} amount={r.insurance} />
          </TableBody>
        </Table>
      </div>

      <FinalCard finalPrice={r.finalPrice} unitPrice={r.unitPrice} totalCost={r.totalCost} profit={r.profit} profitPct={r.profitPct} unit={item.unit} />
    </div>
  );
}

export function FinalCard({ finalPrice, unitPrice, totalCost, profit, profitPct, unit }: {
  finalPrice: number; unitPrice: number; totalCost: number | null; profit: number | null; profitPct: number | null; unit: string;
}) {
  return (
    <div className="rounded-lg bg-primary p-4 text-primary-foreground">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide opacity-80">Final price</div>
          <div className="font-mono text-2xl font-bold">{fmt(finalPrice)} <span className="text-sm font-normal opacity-80">EGP</span></div>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
          <div><dt className="opacity-70">Unit price</dt><dd className="font-mono font-semibold">{fmt2(unitPrice)} / {unit}</dd></div>
          <div><dt className="opacity-70">Total cost</dt><dd className="font-mono font-semibold">{totalCost == null ? "—" : fmt(totalCost)}</dd></div>
          <div><dt className="opacity-70">Profit</dt><dd className="font-mono font-semibold">{profit == null ? "—" : fmt(profit)}</dd></div>
          <div><dt className="opacity-70">Profit %</dt><dd className="font-mono font-semibold">{pct(profitPct)}</dd></div>
        </dl>
      </div>
      {totalCost != null && <p className="mt-2 text-[11px] opacity-80">Final price = total cost + profit</p>}
    </div>
  );
}

export function SpecialBreakdown({ item, r }: { item: BoqItem; r: ItemResult }) {
  if (r.mode === "pricedLike") {
    return (
      <div className="space-y-3">
        <Badge variant="warning">Priced like {r.src}{r.mult !== 1 ? ` × ${r.mult.toFixed(2)}` : ""}</Badge>
        <p className="text-xs text-muted-foreground">This item&apos;s price is derived from {r.src}, as in the workbook. It is not calculated independently.</p>
        <Table>
          <TableBody>
            <TableRow><TableCell className="py-1.5 text-xs">Source item</TableCell><TableCell className="py-1.5 text-right font-mono text-xs">{r.src}</TableCell><TableCell /></TableRow>
            <TableRow><TableCell className="py-1.5 text-xs">Multiplier</TableCell><TableCell className="py-1.5 text-right font-mono text-xs">× {r.mult}</TableCell><TableCell /></TableRow>
            <Row label={`Source unit price (per ${item.unit})`} amount={r.srcUnitPrice} />
            <Row bold label={`Resulting unit price (per ${item.unit})`} amount={r.unitPrice} />
            <Row bold label={`Resulting total (${fmt2(r.qty)} ${item.unit})`} amount={r.finalPrice} />
          </TableBody>
        </Table>
        {r.totalCost != null && <p className="text-[11px] text-muted-foreground">The workbook gives no cost for derived items; cost shown is the source item&apos;s unit cost × this quantity.</p>}
      </div>
    );
  }
  if (r.mode === "fixed") {
    return (
      <div className="space-y-2">
        <Badge variant="default">Fixed price</Badge>
        <p className="text-xs text-muted-foreground">Fixed unit price taken from the workbook: <b className="font-mono text-foreground">{fmt(r.unitPrice)} EGP / {item.unit}</b>. No cost build-up exists for this item.</p>
        <p className="font-mono text-sm">Total: <b>{fmt(r.finalPrice)} EGP</b></p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Badge variant="destructive">Unpriced</Badge>
      <p className="text-xs text-muted-foreground">The workbook has no price for this item, so it contributes 0 to the totals. It is not estimated.</p>
    </div>
  );
}
