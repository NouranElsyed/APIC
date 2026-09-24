"use client";
import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RateInput } from "./pricing-inputs";
import { RatePicker } from "./rate-picker";
import { INSTALL_LABEL } from "./steel-pricing-data";
import { componentOn, fmt, fmt2, pct, profileOf, rateValue } from "./steel-pricing-engine";
import type { BoqItem, CalcResult, CustomBasis, CustomGroup, CustomLine, ItemResult, MaterialTable, ProfileRates, RateBook } from "./types";
import { INSTALL_KEYS } from "./types";

const PROFILE_HINT = "Rate profile (A is the workbook default)";

/** Makes the breakdown editable: every component gets a checkbox and each section gets an "Add line" row. */
export interface BreakdownEditor {
  toggle: (id: string, on: boolean) => void;
  /** Picks the price a component uses (a built-in profile or a price the user added). */
  selectRate: (id: string, optionId: string) => void;
  /** Edits the shared rate book (adds / edits / deletes prices in the library). */
  onRates: (fn: (r: RateBook) => RateBook) => void;
  /** All user-added lines of this item (including unchecked ones). */
  custom: CustomLine[];
  addCustom: (line: Omit<CustomLine, "id" | "enabled">) => void;
  updateCustom: (id: string, patch: Partial<CustomLine>) => void;
  removeCustom: (id: string) => void;
}

function Sub({ n, title, total, totalLabel }: { n: number | string; title: string; total?: number; totalLabel?: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border pb-1">
      <h4 className="text-xs font-semibold">{n}. {title}</h4>
      {total !== undefined && (
        <span className="font-mono text-xs"><span className="mr-2 font-sans text-muted-foreground">{totalLabel}</span><b>{fmt(total)}</b></span>
      )}
    </div>
  );
}

interface RowCheck { on: boolean; onChange: (on: boolean) => void }

function Row({ label, rate, amount, bold, muted, extra, check, off, picker }: {
  label: string; rate?: React.ReactNode; amount: number; bold?: boolean; muted?: boolean; extra?: React.ReactNode; check?: RowCheck; off?: boolean;
  /** Price dropdown shown next to the checkbox label. */
  picker?: React.ReactNode;
}) {
  return (
    <TableRow className={cn(bold && "bg-muted/40 font-semibold", (muted || off) && "text-muted-foreground")}>
      <TableCell className="py-1.5 text-xs">
        {check ? (
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2">
              <Checkbox checked={check.on} onCheckedChange={(v) => check.onChange(v === true)} className="h-3.5 w-3.5" aria-label={label} />
              <span className={cn(off && "line-through decoration-muted-foreground/40")}>{label}</span>
            </label>
            {picker}
          </div>
        ) : label}
      </TableCell>
      {extra !== undefined && <TableCell className="py-1.5 text-xs">{extra}</TableCell>}
      <TableCell className="py-1.5 text-right font-mono text-xs">{rate}</TableCell>
      <TableCell className="py-1.5 text-right font-mono text-xs">{off ? "—" : fmt(amount)}</TableCell>
    </TableRow>
  );
}

const pctOf = (f: number) => `${(f * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

/** User-added lines of one section, each with its checkbox, editable rate and delete button. */
function CustomRows({ group, lines, r, ed, unit, hasExtra }: {
  group: CustomGroup; lines: CustomLine[]; r: CalcResult; ed?: BreakdownEditor; unit: string; hasExtra?: boolean;
}) {
  return (
    <>
      {lines.filter((c) => c.group === group && (ed || c.enabled)).map((c) => {
        const amount = r.customLines.find((x) => x.id === c.id)?.amount ?? 0;
        if (!ed) {
          return <Row key={c.id} label={c.label} extra={hasExtra ? "—" : undefined} rate={c.basis === "perUnit" ? `${fmt2(c.rate)} / ${unit}` : "lump sum"} amount={amount} />;
        }
        return (
          <TableRow key={c.id} className={cn(!c.enabled && "text-muted-foreground")}>
            <TableCell className="py-1.5 text-xs">
              <div className="flex items-center gap-2">
                <Checkbox checked={c.enabled} onCheckedChange={(v) => ed.updateCustom(c.id, { enabled: v === true })} className="h-3.5 w-3.5" aria-label={c.label} />
                <span className={cn(!c.enabled && "line-through decoration-muted-foreground/40")}>{c.label}</span>
                <Badge variant="outline" className="px-1.5 py-0 text-[10px]">Added</Badge>
                <button type="button" onClick={() => ed.removeCustom(c.id)} className="ml-auto text-muted-foreground hover:text-destructive" title="Remove this line" aria-label={`Remove ${c.label}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </TableCell>
            {hasExtra && <TableCell className="py-1.5 text-xs">—</TableCell>}
            <TableCell className="py-1.5">
              <div className="flex items-center justify-end gap-1">
                <RateInput value={c.rate} onChange={(v) => ed.updateCustom(c.id, { rate: v })} className="w-24" />
                <Select value={c.basis} onValueChange={(v) => ed.updateCustom(c.id, { basis: v as CustomBasis })}>
                  <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="perUnit">EGP / {unit}</SelectItem>
                    <SelectItem value="fixed">Lump sum</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </TableCell>
            <TableCell className="py-1.5 text-right font-mono text-xs">{c.enabled ? fmt(amount) : "—"}</TableCell>
          </TableRow>
        );
      })}
    </>
  );
}

/** "+ Add line" row that expands into a small inline form (name, basis, rate). */
function AddLineRow({ group, unit, colSpan, onAdd }: {
  group: CustomGroup; unit: string; colSpan: number; onAdd: (line: Omit<CustomLine, "id" | "enabled">) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [label, setLabel] = React.useState("");
  const [basis, setBasis] = React.useState<CustomBasis>("perUnit");
  const [rate, setRate] = React.useState("");
  const reset = () => { setOpen(false); setLabel(""); setRate(""); setBasis("perUnit"); };
  const submit = () => {
    const name = label.trim();
    const n = rate.trim() === "" ? 0 : Number(rate);
    if (!name || !isFinite(n) || n < 0) return;
    onAdd({ label: name, group, basis, rate: n });
    reset();
  };
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="py-1.5">
        {!open ? (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2" onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") reset(); }}>
            <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Name (e.g. Hot rolled)" className="h-7 w-48 text-xs" />
            <Select value={basis} onValueChange={(v) => setBasis(v as CustomBasis)}>
              <SelectTrigger className="h-7 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="perUnit">EGP per {unit}</SelectItem>
                <SelectItem value="fixed">Lump sum (EGP)</SelectItem>
              </SelectContent>
            </Select>
            <Input value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Rate" inputMode="decimal" className="h-7 w-24 text-right font-mono text-xs" />
            <Button type="button" size="sm" className="h-7" onClick={submit} disabled={!label.trim()}>Add</Button>
            <button type="button" onClick={reset} className="text-xs text-muted-foreground hover:underline">Cancel</button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

export function CalcBreakdown({ item, r, R, mats, editor }: {
  item: Extract<BoqItem, { mode: "calc" }>; r: CalcResult; R: RateBook; mats: MaterialTable;
  /** When given, every component gets a checkbox and each section an "Add line" row. */
  editor?: BreakdownEditor;
}) {
  const s = item.spec;
  const ed = editor;
  const mat = r.matRow ? mats[r.matRow] : null;
  const isSite = item.scope === "Site Activity";
  const supplyOnly = r.supplySalePrice === 0;
  const lines = ed ? ed.custom : r.customLines;
  const has = (g: CustomGroup) => lines.some((c) => c.group === g && (ed || c.enabled));

  // Read-only view shows only what is included; the editor shows every component so it can be ticked.
  const on = (id: string) => componentOn(s, id);
  const show = (id: string) => !!ed || on(id);
  const off = (id: string) => !!ed && !on(id);
  const chk = (id: string): RowCheck | undefined => ed ? { on: on(id), onChange: (v) => ed.toggle(id, v) } : undefined;
    const canMatExtras = !!s.matRow;
  // Rate of the option each component currently uses, and the dropdown that changes it (only for ticked components).
  const pv = (g: ProfileRates, id: string) => rateValue(g, (profileOf(s, id) === "item" ? "A" : profileOf(s, id)) ?? "A");
  const pick = (id: string, groupId: string = id) => {
    const cur = profileOf(s, id);
    return ed && on(id) && cur ? <RatePicker R={R} componentId={id} groupId={groupId} current={cur} onSelect={(p) => ed.selectRate(id, p)} onRates={ed.onRates} /> : undefined;
  };

  const showMaterial = ed || r.materialPrice > 0 || r.accessories > 0 || r.scrap > 0 || r.inflation > 0 || r.customMaterial > 0;
  const showFab = ed || r.totalFabricationCost - r.materialCost > 0;

  return (
    <div className="space-y-4">
      {/* 1. Material */}
      {showMaterial ? (
        <div className="space-y-1.5">
          <Sub n={1} title="Material cost" total={r.materialCost} totalLabel="Material cost" />
          <Table>
            <TableHeader><TableRow><TableHead className="h-7 text-[11px]">Component</TableHead><TableHead className="h-7 text-right text-[11px]">Rate / value</TableHead><TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead></TableRow></TableHeader>
            <TableBody>
              {(s.matRow || r.materialPrice > 0) && <Row label={`Material price — ${mat?.label ?? "n/a"}`} rate={`${fmt2(r.materialRate)} / ${mat?.unit ?? "unit"}`} amount={r.materialPrice} />}
              {show("handling") && (canMatExtras || on("handling")) && <Row check={chk("handling")} off={off("handling")} picker={pick("handling")} label="Handling" rate={pctOf(pv(R.handling, "handling"))} amount={r.handling} />}
              {show("scrap") && (canMatExtras || !!s.scrapLink) && <Row check={chk("scrap")} off={off("scrap")} picker={pick("scrap")} label="Scrap" rate={s.scrapLink ? `${pctOf(pv(R.scrap, "scrap"))} of ${s.scrapLink.item} material` : pctOf(pv(R.scrap, "scrap"))} amount={r.scrap} />}
              {show("accessories") && (canMatExtras || !!s.accessoriesLink) && <Row check={chk("accessories")} off={off("accessories")} picker={pick("accessories")} label="Accessories" rate={s.accessoriesLink ? `${pctOf(s.accessoriesLink.k)} of ${s.accessoriesLink.item} material` : pctOf(pv(R.accessories, "accessories"))} amount={r.accessories} />}
              {show("inflation") && canMatExtras && <Row check={chk("inflation")} off={off("inflation")} picker={pick("inflation")} label="Inflation" rate={`${pctOf(pv(R.inflation, "inflation"))} of material price`} amount={r.inflation} />}
              <CustomRows group="material" lines={lines} r={r} ed={ed} unit={item.unit} />
              {ed && <AddLineRow group="material" unit={item.unit} colSpan={3} onAdd={ed.addCustom} />}
              <Row bold label="Material cost" amount={r.materialCost} />
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">1. Material — no material is supplied for this activity (labour / installation only).</p>
      )}

      {/* 2. Fabrication */}
      {showFab ? (
        <div className="space-y-1.5">
          <Sub n={2} title="Fabrication cost" total={r.totalFabricationCost - r.materialCost + r.fabIndirect} totalLabel="Fabrication cost" />
          <Table>
            <TableHeader><TableRow><TableHead className="h-7 text-[11px]">Component</TableHead><TableHead className="h-7 text-right text-[11px]">Rate</TableHead><TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead></TableRow></TableHeader>
            <TableBody>
              {show("cutting") && <Row check={chk("cutting")} off={off("cutting")} picker={pick("cutting")} label="Cutting" rate={fmt(pv(R.cutting, "cutting"))} amount={r.cutting} />}
              {show("welding") && <Row check={chk("welding")} off={off("welding")} picker={pick("welding")} label="Fit-up & welding" rate={fmt(pv(R.welding, "welding"))} amount={r.welding} />}
              {show("rolling") && <Row check={chk("rolling")} off={off("rolling")} picker={pick("rolling")} label="Rolling" rate={`${fmt(pv(R.rolling, "rolling"))} EGP/t`} amount={r.rolling} />}
              <CustomRows group="fabrication" lines={lines} r={r} ed={ed} unit={item.unit} />
              {show("ndt") && <Row check={chk("ndt")} off={off("ndt")} picker={pick("ndt")} label="NDT" rate={`${pctOf(pv(R.ndt, "ndt"))} of fabrication`} amount={r.ndt} />}
              {show("painting") && <Row check={chk("painting")} off={off("painting")} picker={pick("painting", r.paintBasis === "area" ? "paintingArea" : "painting")} label={r.paintBasis === "area" ? "Painting (per m²)" : "Painting (per ton)"}
                rate={r.paintBasis === "area"
                  ? `${fmt2(r.paintRate)} EGP/m² × ${fmt2(r.paintArea)} m²`
                  : s.paintingRate ? `${fmt(s.paintingRate)} (item rate)` : `${fmt(pv(R.painting, "painting"))} EGP/t`} amount={r.painting} />}
              {show("fabIndirect") && <Row check={chk("fabIndirect")} off={off("fabIndirect")} picker={pick("fabIndirect")} label="Fabrication indirect" rate={`${pctOf(pv(R.fabIndirect, "fabIndirect"))} of (material + fabrication)`} amount={r.fabIndirect} />}
              {ed && <AddLineRow group="fabrication" unit={item.unit} colSpan={3} onAdd={ed.addCustom} />}
              <Row bold label="Fabrication cost" amount={r.totalFabricationCost - r.materialCost + r.fabIndirect} />
              <Row muted label="Supply & fabrication sale price (with margins)" rate={<span title="Margin multipliers on material, fabrication, NDT and painting">×{R.margins.material} / {R.margins.fabrication} / {R.margins.ndt} / {s.paintingMargin ?? R.margins.painting}</span>} amount={r.supplySalePrice} />
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">2. Fabrication — none for this item.</p>
      )}

      {/* 2b. Subcontractor (workbook columns "Subcontractor" / "Subcontract Sale Price") */}
      {(ed || on("subcontract")) && (
        <div className="space-y-1.5">
          <Sub n="2b" title="Subcontractor" total={r.subcontractSale} totalLabel="Subcontract sale price" />
          <Table>
            <TableHeader><TableRow><TableHead className="h-7 text-[11px]">Component</TableHead><TableHead className="h-7 text-right text-[11px]">Rate</TableHead><TableHead className="h-7 text-right text-[11px]">Amount (EGP)</TableHead></TableRow></TableHeader>
            <TableBody>
              <Row check={chk("subcontract")} off={off("subcontract")} picker={pick("subcontract")} label="Subcontractor cost" rate={`${fmt2(pv(R.subcontract, "subcontract"))} EGP / ${item.unit} × ${fmt2(r.weight)}`} amount={r.subcontract} />
              <Row muted label="Subcontract sale price" rate={`cost × ${R.subcontractMargin}`} amount={r.subcontractSale} />
            </TableBody>
          </Table>
        </div>
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
            {ed
              ? INSTALL_KEYS.map((k) => {
                  const l = r.installLines.find((x) => x.key === k);
                  const id = `install.${k}`;
                  return l
                    ? <Row key={k} check={chk(id)} label={INSTALL_LABEL[k]} extra={pick(id) ?? l.profile} rate={`${fmt2(l.rate)} × ${fmt2(l.weight * l.factor)}`} amount={l.amount} />
                    : <Row key={k} check={chk(id)} off label={INSTALL_LABEL[k]} extra="—" rate={`${fmt2(R.install[k].A ?? 0)} (profile A)`} amount={0} />;
                })
              : r.installLines.map((l) => (
                  <Row key={l.key} label={INSTALL_LABEL[l.key]} extra={l.profile} rate={`${fmt2(l.rate)} × ${fmt2(l.weight * l.factor)}`} amount={l.amount} />
                ))}
            <CustomRows group="installation" lines={lines} r={r} ed={ed} unit={item.unit} hasExtra />
            {ed && <AddLineRow group="installation" unit={item.unit} colSpan={4} onAdd={ed.addCustom} />}
            {!ed && r.installLines.length === 0 && !has("installation") && <TableRow><TableCell colSpan={4} className="py-1.5 text-xs text-muted-foreground">No installation activities.</TableCell></TableRow>}
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
            <Row check={chk("mob")} label="Mobilization / demobilization" rate={s.mob ? pctOf(R.mobDemob) : "not applied"} amount={r.mobDemob} />
            <Row check={chk("height")} label="Height factor" rate={s.height ? pctOf(R.heightFactor) : "not applied"} amount={r.heightFactor} />
            <Row check={chk("thirdParty")} label="Third-party certificate" rate={s.thirdParty ? pctOf(R.thirdParty) : "not applied"} amount={r.thirdParty} />
            <Row check={chk("commissioning")} label="Commissioning" rate={s.commissioning ? pctOf(R.commissioning) : "not applied"} amount={r.commissioning} />
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
