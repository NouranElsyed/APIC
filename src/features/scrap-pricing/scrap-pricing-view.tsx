"use client";
// Read-only reference showing exactly how every number on the Scrap &
// Material screen is calculated. Pulls its formula list from the same
// column-for-column mapping documented in src/server/calc/scrap-pricing.ts
// (kept in one place there; this file only presents it) so it can never
// silently drift from the real calculation code.
//
// Two entry points:
//   - <FormulasDialog scope={{ type: "totals" }} .../>  — the whole-project totals
//   - <FormulasDialog scope={{ type: "row", row }} .../> — one material/thickness row
// Both render the same symbolic formula PLUS the live numbers substituted
// in, so a user can visually verify "yes, this is really how 64,998 LE was
// computed" rather than trusting a black box.

import * as React from "react";
import { Sigma, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { ScrapPricingRow, ScrapPricingTotals, ScrapPricingGlobalInputs } from "./types";

function fmt(n: number, digits = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
function pctFmt(n: number, digits = 1) {
  return `${fmt(n * 100, digits)}%`;
}

// A single row-scoped set of numbers the formulas below substitute into.
// Built once from either a per-item row or the project totals so the same
// formula table works for both scopes.
interface FormulaValues {
  itemLabel: string;
  costPerKg: number;
  usedLaterPct: number;
  usedLaterPriceLEPerKg: number;
  scrapSellPriceLEPerKg: number;
  usedAreaSqm: number;
  usedWeightKg: number;
  buyQty: number | null; // totals has no single "quantity"
  buyAreaSqm: number;
  buyWeightKg: number;
  primaryScrapWeightKg: number;
  primaryScrapPct: number;
  costUsedLE: number;
  weightUsedLaterKg: number;
  usedLaterCostLE: number;
  usedLaterValueLE: number;
  actualScrapWeightKg: number;
  actualScrapCostLE: number;
  scrapValueLE: number;
  netScrapAdjustmentLE: number;
  valueUsedLE: number;
  buyCostLE: number;
  actualScrapPct: number;
}

function valuesFromRow(row: ScrapPricingRow): FormulaValues {
  return {
    itemLabel: row.itemLabel,
    costPerKg: row.costPerKg,
    usedLaterPct: row.usedLaterPct,
    usedLaterPriceLEPerKg: row.usedLaterPriceLEPerKg,
    scrapSellPriceLEPerKg: row.scrapSellPriceLEPerKg,
    usedAreaSqm: row.usedAreaSqm,
    usedWeightKg: row.usedWeightKg,
    buyQty: row.buyQty,
    buyAreaSqm: row.buyAreaSqm,
    buyWeightKg: row.buyWeightKg,
    primaryScrapWeightKg: row.primaryScrapWeightKg,
    primaryScrapPct: row.primaryScrapPct,
    costUsedLE: row.costUsedLE,
    weightUsedLaterKg: row.weightUsedLaterKg,
    usedLaterCostLE: row.usedLaterCostLE,
    usedLaterValueLE: row.usedLaterValueLE,
    actualScrapWeightKg: row.actualScrapWeightKg,
    actualScrapCostLE: row.actualScrapCostLE,
    scrapValueLE: row.scrapValueLE,
    netScrapAdjustmentLE: row.netScrapAdjustmentLE,
    valueUsedLE: row.valueUsedLE,
    buyCostLE: row.buyCostLE,
    actualScrapPct: row.actualScrapPct,
  };
}

function valuesFromTotals(totals: ScrapPricingTotals, inputs: ScrapPricingGlobalInputs): FormulaValues {
  return {
    itemLabel: "All items (project totals)",
    costPerKg: inputs.costPerKg,
    usedLaterPct: inputs.usedLaterPct,
    usedLaterPriceLEPerKg: inputs.usedLaterPriceLEPerKg,
    scrapSellPriceLEPerKg: inputs.scrapSellPriceLEPerKg,
    usedAreaSqm: totals.totalUsedAreaSqm,
    usedWeightKg: totals.totalUsedWeightKg,
    buyQty: null,
    buyAreaSqm: totals.totalBuyAreaSqm,
    buyWeightKg: totals.totalBuyWeightKg,
    primaryScrapWeightKg: totals.totalPrimaryScrapWeightKg,
    primaryScrapPct: 1 - (totals.totalBuyWeightKg === 0 ? 0 : totals.totalUsedWeightKg / totals.totalBuyWeightKg),
    costUsedLE: totals.totalCostUsedLE,
    weightUsedLaterKg: totals.totalWeightUsedLaterKg,
    usedLaterCostLE: totals.totalUsedLaterCostLE,
    usedLaterValueLE: totals.totalUsedLaterValueLE,
    actualScrapWeightKg: totals.totalActualScrapWeightKg,
    actualScrapCostLE: totals.totalActualScrapCostLE,
    scrapValueLE: totals.totalScrapValueLE,
    netScrapAdjustmentLE: totals.totalNetScrapAdjustmentLE,
    valueUsedLE: totals.totalValueUsedLE,
    buyCostLE: totals.totalBuyCostLE,
    actualScrapPct: totals.actualScrapPctFromBought,
  };
}

// One formula "card": a name, the symbolic equation, and a function that
// renders the same equation with the real numbers plugged in for the
// current scope (row or totals).
interface FormulaDef {
  key: string;
  label: string;
  excelCol?: string; // traceability back to the reference workbook column
  symbolic: string;
  substituted: (v: FormulaValues) => string;
  result: (v: FormulaValues) => string;
}

const FORMULAS: FormulaDef[] = [
  {
    key: "usedMaterial",
    label: "Used Material (Area & Weight)",
    excelCol: "B, C",
    symbolic: "Taken directly from the project's current DXF Nesting result — the real nested polygon area/weight, never a bounding box.",
    substituted: () => "— (comes from DXF Nesting, not a formula)",
    result: (v) => `${fmt(v.usedAreaSqm, 3)} m² · ${fmt(v.usedWeightKg, 1)} kg`,
  },
  {
    key: "purchasedMaterial",
    label: "Purchased Material (Qty, Area & Weight)",
    excelCol: "E, F, G",
    symbolic: "Taken directly from the Nesting Engine's required-sheet calculation (how many full sheets had to be bought).",
    substituted: () => "— (comes from Nesting Engine, not a formula)",
    result: (v) => `${v.buyQty != null ? `${v.buyQty} sheet(s) · ` : ""}${fmt(v.buyAreaSqm, 3)} m² · ${fmt(v.buyWeightKg, 1)} kg`,
  },
  {
    key: "primaryScrapWeight",
    label: "Primary Scrap (weight)",
    excelCol: "H",
    symbolic: "Primary Scrap Wt = Buy Wt − Used Wt",
    substituted: (v) => `${fmt(v.buyWeightKg, 1)} − ${fmt(v.usedWeightKg, 1)}`,
    result: (v) => `${fmt(v.primaryScrapWeightKg, 1)} kg`,
  },
  {
    key: "primaryScrapPct",
    label: "Primary Scrap %",
    excelCol: "H",
    symbolic: "Primary Scrap % = 1 − (Used Wt ÷ Buy Wt)",
    substituted: (v) => `1 − (${fmt(v.usedWeightKg, 1)} ÷ ${fmt(v.buyWeightKg, 1)})`,
    result: (v) => pctFmt(v.primaryScrapPct),
  },
  {
    key: "costUsed",
    label: "Cost Used",
    excelCol: "I",
    symbolic: "Cost Used (LE) = Cost/kg × Used Wt",
    substituted: (v) => `${fmt(v.costPerKg, 2)} × ${fmt(v.usedWeightKg, 1)}`,
    result: (v) => `${fmt(v.costUsedLE, 0)} LE`,
  },
  {
    key: "usedLaterWeight",
    label: "Used Later — Weight",
    excelCol: "K",
    symbolic: "Used Later Wt = (Buy Wt − Used Wt) × %Used Later",
    substituted: (v) => `(${fmt(v.buyWeightKg, 1)} − ${fmt(v.usedWeightKg, 1)}) × ${pctFmt(v.usedLaterPct)}`,
    result: (v) => `${fmt(v.weightUsedLaterKg, 1)} kg`,
  },
  {
    key: "usedLaterCost",
    label: "Used Later — Cost",
    excelCol: "M",
    symbolic: "Used Later Cost (LE) = Used Later Wt × Cost/kg",
    substituted: (v) => `${fmt(v.weightUsedLaterKg, 1)} × ${fmt(v.costPerKg, 2)}`,
    result: (v) => `${fmt(v.usedLaterCostLE, 0)} LE`,
  },
  {
    key: "usedLaterValue",
    label: "Used Later — Value",
    excelCol: "N",
    symbolic: "Used Later Value (LE) = Used Later Wt × Used Later Price/kg",
    substituted: (v) => `${fmt(v.weightUsedLaterKg, 1)} × ${fmt(v.usedLaterPriceLEPerKg, 2)}`,
    result: (v) => `${fmt(v.usedLaterValueLE, 0)} LE`,
  },
  {
    key: "actualScrapWeight",
    label: "Actual Scrap — Weight",
    excelCol: "O",
    symbolic: "Actual Scrap Wt = Buy Wt − Used Wt − Used Later Wt",
    substituted: (v) => `${fmt(v.buyWeightKg, 1)} − ${fmt(v.usedWeightKg, 1)} − ${fmt(v.weightUsedLaterKg, 1)}`,
    result: (v) => `${fmt(v.actualScrapWeightKg, 1)} kg`,
  },
  {
    key: "actualScrapCost",
    label: "Actual Scrap — Cost basis",
    excelCol: "P",
    symbolic: "Actual Scrap Cost (LE) = Actual Scrap Wt × Cost/kg",
    substituted: (v) => `${fmt(v.actualScrapWeightKg, 1)} × ${fmt(v.costPerKg, 2)}`,
    result: (v) => `${fmt(v.actualScrapCostLE, 0)} LE`,
  },
  {
    key: "scrapValue",
    label: "Scrap Value (sold)",
    excelCol: "Q",
    symbolic: "Scrap Value (LE) = Actual Scrap Wt × Scrap Selling Price/kg",
    substituted: (v) => `${fmt(v.actualScrapWeightKg, 1)} × ${fmt(v.scrapSellPriceLEPerKg, 2)}`,
    result: (v) => `${fmt(v.scrapValueLE, 0)} LE`,
  },
  {
    key: "netScrapAdjustment",
    label: "Net Scrap Adjustment",
    excelCol: "R",
    symbolic: "Net Adj. (LE) = (Actual Scrap Cost − Scrap Value) + (Used Later Cost − Used Later Value)",
    substituted: (v) =>
      `(${fmt(v.actualScrapCostLE, 0)} − ${fmt(v.scrapValueLE, 0)}) + (${fmt(v.usedLaterCostLE, 0)} − ${fmt(v.usedLaterValueLE, 0)})`,
    result: (v) => `${fmt(v.netScrapAdjustmentLE, 0)} LE`,
  },
  {
    key: "valueUsed",
    label: "Value Used",
    excelCol: "S",
    symbolic: "Value Used (LE) = Cost Used + Scrap Value + Used Later Value",
    substituted: (v) => `${fmt(v.costUsedLE, 0)} + ${fmt(v.scrapValueLE, 0)} + ${fmt(v.usedLaterValueLE, 0)}`,
    result: (v) => `${fmt(v.valueUsedLE, 0)} LE`,
  },
  {
    key: "buyCost",
    label: "Buy Cost",
    excelCol: "T",
    symbolic: "Buy Cost (LE) = Cost/kg × Buy Wt",
    substituted: (v) => `${fmt(v.costPerKg, 2)} × ${fmt(v.buyWeightKg, 1)}`,
    result: (v) => `${fmt(v.buyCostLE, 0)} LE`,
  },
  {
    key: "actualScrapPct",
    label: "Actual Scrap %",
    excelCol: "U",
    symbolic: "Actual Scrap % = 1 − (Value Used ÷ Buy Cost)",
    substituted: (v) => `1 − (${fmt(v.valueUsedLE, 0)} ÷ ${fmt(v.buyCostLE, 0)})`,
    result: (v) => pctFmt(v.actualScrapPct),
  },
];

// Totals-only formulas (weighted averages / project-wide %) that don't
// exist per-row — shown only when scope === "totals".
const TOTALS_ONLY_FORMULAS: FormulaDef[] = [
  {
    key: "avgCostPerKg",
    label: "Weighted Avg. Cost/kg",
    excelCol: "D17",
    symbolic: "Avg Cost/kg = Total Cost Used ÷ Total Used Wt",
    substituted: (v) => `${fmt(v.costUsedLE, 0)} ÷ ${fmt(v.usedWeightKg, 1)}`,
    result: (v) => `${fmt(v.costUsedLE / (v.usedWeightKg || 1), 2)} LE/kg`,
  },
  {
    key: "scrapPctFromBought",
    label: "Scrap % (from Bought Material)",
    excelCol: "T19",
    symbolic: "= 1 − (Total Value Used ÷ Total Buy Cost)",
    substituted: (v) => `1 − (${fmt(v.valueUsedLE, 0)} ÷ ${fmt(v.buyCostLE, 0)})`,
    result: (v) => pctFmt(v.actualScrapPct),
  },
  {
    key: "scrapPctFromUsed",
    label: "Scrap % (from Used Material)",
    excelCol: "T20",
    symbolic: "= Total Net Scrap Adjustment ÷ Total Cost Used",
    substituted: (v) => `${fmt(v.netScrapAdjustmentLE, 0)} ÷ ${fmt(v.costUsedLE, 0)}`,
    result: (v) => pctFmt(v.costUsedLE === 0 ? 0 : v.netScrapAdjustmentLE / v.costUsedLE),
  },
];

export type FormulaScope =
  | { type: "totals"; totals: ScrapPricingTotals; inputs: ScrapPricingGlobalInputs }
  | { type: "row"; row: ScrapPricingRow };

function FormulaTable({ values, showTotalsOnly }: { values: FormulaValues; showTotalsOnly: boolean }) {
  const defs = showTotalsOnly ? [...FORMULAS, ...TOTALS_ONLY_FORMULAS] : FORMULAS;
  return (
    <div className="space-y-2">
      {defs.map((f) => (
        <div key={f.key} className="rounded-lg border border-border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-foreground">{f.label}</p>
            {f.excelCol && <span className="shrink-0 text-[10px] text-muted-foreground">col {f.excelCol}</span>}
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{f.symbolic}</p>
          <p className="mt-1 font-mono text-xs text-sky-700 dark:text-sky-400">= {f.substituted(values)}</p>
          <p className="mt-1 text-sm font-semibold text-foreground">= {f.result(values)}</p>
        </div>
      ))}
    </div>
  );
}

/** The trigger + dialog for the whole-project "Show Formulas" view. */
export function FormulasDialogTrigger({ scope }: { scope: FormulaScope | null }) {
  const [open, setOpen] = React.useState(false);
  if (!scope) return null;

  const values = scope.type === "totals" ? valuesFromTotals(scope.totals, scope.inputs) : valuesFromRow(scope.row);
  const showTotalsOnly = scope.type === "totals";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Sigma className="h-4 w-4" />
        عرض المعادلات
      </Button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>كل حساب في هذه الصفحة — خطوة بخطوة</DialogTitle>
          <DialogDescription>
            {values.itemLabel} — كل صيغة موضّح جنبها الرمز، ثم نفس الصيغة بالأرقام الحقيقية الحالية، ثم الناتج.
          </DialogDescription>
        </DialogHeader>
        <FormulaTable values={values} showTotalsOnly={showTotalsOnly} />
      </DialogContent>
    </Dialog>
  );
}

/** A small inline "ⓘ" button for one table row — opens the same dialog scoped to that row's real numbers. */
export function RowFormulaButton({ row }: { row: ScrapPricingRow }) {
  const [open, setOpen] = React.useState(false);
  const values = valuesFromRow(row);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        title="عرض طريقة الحساب لهذا الصنف"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>طريقة حساب: {row.itemLabel}</DialogTitle>
          <DialogDescription>كل صيغة بالرمز، ثم بالأرقام الحقيقية لهذا الصنف، ثم الناتج.</DialogDescription>
        </DialogHeader>
        <FormulaTable values={values} showTotalsOnly={false} />
      </DialogContent>
    </Dialog>
  );
}

// Formula strings keyed by the same labels used for the Stat cards / table
// headers in scrap-pricing-view.tsx, for quick native-tooltip (title=) hints
// without opening the full dialog.
export const QUICK_TOOLTIPS: Record<string, string> = {
  usedArea: "من نتيجة الـ DXF Nesting الحالية مباشرة (المساحة الحقيقية، مش bounding box)",
  usedWeight: "من نتيجة الـ DXF Nesting الحالية مباشرة",
  buyWeight: "من عدد الألواح المطلوب شراؤها (Nesting Engine)",
  usedLater: "= (وزن الشراء − وزن الاستخدام) × %المستخدم لاحقًا",
  actualScrap: "= وزن الشراء − وزن الاستخدام − وزن المستخدم لاحقًا",
  buyCost: "= سعر الكيلو × وزن الشراء",
  usedLaterValue: "= وزن المستخدم لاحقًا × سعر المستخدم لاحقًا للكيلو",
  scrapValue: "= وزن الخردة الفعلي × سعر بيع الخردة للكيلو",
  scrapPctBought: "= 1 − (إجمالي القيمة المستخدمة ÷ إجمالي تكلفة الشراء)",
  scrapPctUsed: "= إجمالي صافي تسوية الخردة ÷ إجمالي تكلفة الاستخدام",
  primaryScrapPct: "= 1 − (وزن الاستخدام ÷ وزن الشراء)",
  costUsed: "= سعر الكيلو × وزن الاستخدام",
  actualScrapPct: "= 1 − (القيمة المستخدمة ÷ تكلفة الشراء)",
};
