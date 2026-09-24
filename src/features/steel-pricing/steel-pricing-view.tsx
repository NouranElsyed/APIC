"use client";
import * as React from "react";
import { Ruler, RotateCcw } from "lucide-react";
import { BoqSection } from "./boq-section";
import { ItemCalculator } from "./item-calculator";
import { PricingSetup } from "./pricing-setup";
import { DEFAULT_ITEMS } from "./steel-pricing-data";
import { calcBoq, fmt, pct } from "./steel-pricing-engine";
import { defaultState, loadState, saveState, type PricingState } from "./steel-pricing-storage";
import type { ItemOverride, RateBook } from "./types";

export function SteelPricingView({ canExport }: { canExport: boolean }) {
  const [state, setState] = React.useState<PricingState>(defaultState);
  const [hydrated, setHydrated] = React.useState(false);

  // Load saved state after mount (avoids SSR/client mismatch), and only persist once loaded.
  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(loadState());
    setHydrated(true);
  }, []);
  React.useEffect(() => {
    if (hydrated) saveState(state);
  }, [state, hydrated]);

  const boq = React.useMemo(() => calcBoq(DEFAULT_ITEMS, state.rates, state.materials, state.overrides), [state]);

  const onRates = React.useCallback((fn: (r: RateBook) => RateBook) => setState((s) => ({ ...s, rates: fn(s.rates) })), []);
  const onMaterialPrice = React.useCallback((row: number, price: number) =>
    setState((s) => ({ ...s, materials: { ...s.materials, [row]: { ...s.materials[row], price } } })), []);
  const onOverride = React.useCallback((no: string, patch: ItemOverride | null) =>
    setState((s) => {
      const overrides = { ...s.overrides };
      if (patch === null) { delete overrides[no]; return { ...s, overrides }; }
      const merged: ItemOverride = { ...overrides[no], ...patch };
      // Drop empty leftovers (e.g. every checkbox back at the workbook default) so the row no longer counts as edited.
      for (const k of Object.keys(merged) as (keyof ItemOverride)[]) {
        const v = merged[k];
        if (v === undefined || (typeof v === "object" && v !== null && Object.keys(v).length === 0)) delete merged[k];
      }
      if (Object.keys(merged).length === 0) delete overrides[no]; else overrides[no] = merged;
      return { ...s, overrides };
    }), []);

  const t = boq.totals;
  const dirty = JSON.stringify(state) !== JSON.stringify(defaultState());

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-20 -mx-1 space-y-2 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Ruler className="h-4 w-4" /></div>
            <div>
              <h2 className="text-sm font-semibold leading-tight">Steel Pricing — Project summary</h2>
              <p className="text-[11px] text-muted-foreground">{DEFAULT_ITEMS.length} BOQ items · {fmt(t.weight)} t priced by calculation · all values live</p>
            </div>
          </div>
          {dirty && (
            <button onClick={() => { if (window.confirm("Reset every rate, material price and BOQ edit to the workbook defaults?")) setState(defaultState()); }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
              <RotateCcw className="h-3 w-3" /> Reset to workbook
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Supply & fabrication" value={fmt(t.supply)} />
          <Stat label="Dismantle & installation" value={fmt(t.install)} />
          <Stat label="Additional costs*" value={fmt(t.additional)} />
          <Stat label="Tax & insurance*" value={fmt(t.taxInsurance)} />
          <Stat label="Grand total (EGP)" value={fmt(t.grand)} primary />
          <Stat label="Total cost†" value={fmt(t.totalCost)} />
          <Stat label="Total profit†" value={fmt(t.profit)} />
          <Stat label="Profit %†" value={pct(t.profitPct)} />
        </div>
      </div>

      <PricingSetup rates={state.rates} materials={state.materials} onRates={onRates} onMaterialPrice={onMaterialPrice} />
      <ItemCalculator rates={state.rates} materials={state.materials} />
      <BoqSection items={DEFAULT_ITEMS} result={boq} rates={state.rates} materials={state.materials} overrides={state.overrides} onOverride={onOverride} />

      <div className="max-w-4xl space-y-1 text-[11px] leading-relaxed text-muted-foreground">
        <p>* Included within the grand total; summed over calculated items. † Cost and profit cover the {t.costedItems} items with a cost build-up ({DEFAULT_ITEMS.length - t.costedItems} fixed-price and unpriced items have none).</p>
        <p><b className="text-foreground">Source:</b> rates, item structure and formulas follow &ldquo;Cost Estimation- Steel Structure.xlsx&rdquo; (sheet BOQ - Full). Priced-like items reuse their source item&apos;s unit price, exactly as in the workbook. Unpriced items (e.g. crane rails S2.6–S4.6) are blank in the workbook and stay at 0.</p>
        {!canExport && <p>Exporting a priced workbook from this tool requires the Scrap &amp; Material export permission.</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className={primary ? "rounded-lg bg-primary px-3 py-1.5 text-primary-foreground" : "rounded-lg border border-border bg-card px-3 py-1.5"}>
      <div className={primary ? "text-[10px] opacity-80" : "text-[10px] text-muted-foreground"}>{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
