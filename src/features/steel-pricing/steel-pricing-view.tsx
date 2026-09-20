"use client";
import * as React from "react";
import { AlertTriangle, Ruler } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DEFAULT_ITEMS, DEFAULT_SETTINGS, FAMILIES, FAM_ORDER, SECTION_LABEL, SETTINGS_META,
} from "./steel-pricing-data";
import { calcItem, fmt, fmt2, installRate } from "./steel-pricing-engine";
import type { BoqItem, InstallRateKey, PricingScope, PricingSettings } from "./types";

const INSTALL_RATE_COLS: { key: InstallRateKey; label: string }[] = [
  { key: "transportRate", label: "Transport" },
  { key: "handlingPerTon", label: "Site handling" },
  { key: "packingPerTon", label: "Packing" },
  { key: "cranePerTon", label: "Crane" },
  { key: "scaffoldPerTon", label: "Scaffolding" },
  { key: "manHourPerTon", label: "Labor hours" },
  { key: "safetyPerTon", label: "Safety" },
  { key: "toolsPerTon", label: "Tools" },
  { key: "ppePerTon", label: "PPE" },
  { key: "touchUpPerTon", label: "Touch-up" },
  { key: "weldSurveyorPerTon", label: "Weld survey" },
];

const SETTINGS_STORAGE_KEY = "steelflow_pricing_settings_v1";
const ITEMS_STORAGE_KEY = "steelflow_pricing_items_v1";

function loadFromStorage<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveToStorage(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota / privacy-mode errors
  }
}

function initialSettings(): PricingSettings {
  const saved = loadFromStorage<PricingSettings>(SETTINGS_STORAGE_KEY);
  return saved ? { ...DEFAULT_SETTINGS, ...saved } : DEFAULT_SETTINGS;
}

function initialItems(): BoqItem[] {
  const saved = loadFromStorage<Pick<BoqItem, "id" | "qty" | "fam">[]>(ITEMS_STORAGE_KEY);
  if (!saved || saved.length !== DEFAULT_ITEMS.length) return DEFAULT_ITEMS;
  return DEFAULT_ITEMS.map((it, i) =>
    saved[i] && saved[i].id === it.id ? { ...it, qty: saved[i].qty, fam: saved[i].fam } : it
  );
}

export function SteelPricingView({ canExport }: { canExport: boolean }) {
  const [settings, setSettings] = React.useState<PricingSettings>(initialSettings);
  const [items, setItems] = React.useState<BoqItem[]>(initialItems);
  // Bumped whenever a material rate (stored in FAMILIES) changes, so memos recompute
  const [famVersion, setFamVersion] = React.useState(0);

  // Calculator tab state
  const [calcFam, setCalcFam] = React.useState("st37");
  const [calcScope, setCalcScope] = React.useState<PricingScope>("Supply");
  const [calcQty, setCalcQty] = React.useState(10);

  // BOQ tab state
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "supply" | "install">("all");

  React.useEffect(() => {
    saveToStorage(SETTINGS_STORAGE_KEY, settings);
  }, [settings]);

  React.useEffect(() => {
    saveToStorage(ITEMS_STORAGE_KEY, items.map((it) => ({ id: it.id, qty: it.qty, fam: it.fam })));
  }, [items]);

  function updateSetting(key: keyof PricingSettings, value: number) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function updateItem(id: number, patch: Partial<Pick<BoqItem, "qty" | "fam">>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  const totals = React.useMemo(() => {
    let supplyTotal = 0, installTotal = 0;
    items.forEach((it) => {
      const r = calcItem(it.qty, it.fam, it.scope, settings);
      const t = r.flag ? 0 : r.total;
      if (it.sec === "supply") supplyTotal += t; else installTotal += t;
    });
    return { supplyTotal, installTotal, grand: supplyTotal + installTotal };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, settings, famVersion]);

  return (
    <div className="space-y-6">
      {/* Sticky live-totals bar: always visible while editing any section below */}
      <div className="sticky top-0 z-20 -mx-1 flex flex-col gap-3 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-sm backdrop-blur sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Ruler className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Steel Structures Pricing Engine</h2>
            <p className="text-xs text-muted-foreground">
              Rates, calculator and BOQ on one page. Change any value and everything updates live.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TotalChip label="Total Supply" value={totals.supplyTotal} />
          <TotalChip label="Total Dismantle & Install" value={totals.installTotal} />
          <TotalChip label="Grand Total (EGP)" value={totals.grand} highlight />
        </div>
      </div>

      {/* ================= SECTION 1: RATE CARD ================= */}
      <section className="space-y-5">
        <h3 className="text-sm font-semibold">1. Base Rate Card</h3>
        <p className="max-w-2xl text-xs text-muted-foreground">
          Every value that was scattered across many columns in the original sheet is grouped here into 4 clear
          groups, plus a material rate table. Change any number and pricing updates instantly across the whole page.
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {SETTINGS_META.map((group) => (
            <Card key={group.key}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-xs font-semibold text-primary">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  {group.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 pt-0">
                {group.fields.map((f) => (
                  <div key={f.key} className="flex items-center justify-between gap-2 border-b border-dashed border-border py-1.5 last:border-none">
                    <Label className="flex-1 text-xs font-normal text-muted-foreground">{f.label}</Label>
                    <Input
                      type="number"
                      step="any"
                      value={settings[f.key]}
                      onChange={(e) => updateSetting(f.key, parseFloat(e.target.value) || 0)}
                      className="h-7 w-24 font-mono text-xs"
                    />
                    <span className="w-9 text-[11px] text-muted-foreground">{f.suffix}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-muted/40">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Material / Family</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Material price / unit</TableHead>
                <TableHead>Fabrication & welding rate / unit</TableHead>
                <TableHead>Painting rate / unit</TableHead>
                <TableHead>Scrap %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FAM_ORDER.filter((k) => !FAMILIES[k].flag).map((key) => {
                const fam = FAMILIES[key];
                return (
                  <TableRow key={key}>
                    <TableCell className="whitespace-nowrap font-medium">{fam.name}</TableCell>
                    <TableCell><Badge variant="gray">{fam.unit}</Badge></TableCell>
                    {(["materialPrice", "weldingRate", "paintingRate", "scrapPct"] as const).map((prop) => (
                      <TableCell key={prop}>
                        <Input
                          type="number"
                          step="any"
                          value={fam[prop]}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value) || 0;
                            FAMILIES[key][prop] = v;
                            setFamVersion((n) => n + 1); // trigger recompute everywhere
                          }}
                          className="h-7 w-20 font-mono text-xs"
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="mb-1 text-xs font-semibold">Install rates per material (EGP / MT)</h4>
          <p className="mb-2 max-w-2xl text-xs text-muted-foreground">
            Site handling, crane, etc. can cost differently depending on what is being handled. Leave a cell
            empty to use the global rate (shown as the placeholder); type a value to override it for that material only.
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-muted/40">
            <Table className="min-w-[1100px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Material / Family</TableHead>
                  {INSTALL_RATE_COLS.map((c) => <TableHead key={c.key}>{c.label}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {FAM_ORDER.filter((k) => !FAMILIES[k].flag).map((key) => {
                  const fam = FAMILIES[key];
                  return (
                    <TableRow key={key}>
                      <TableCell className="whitespace-nowrap font-medium">{fam.name}</TableCell>
                      {INSTALL_RATE_COLS.map((c) => {
                        const ov = fam.installOverrides?.[c.key];
                        return (
                          <TableCell key={c.key}>
                            <Input
                              type="number"
                              step="any"
                              placeholder={String(settings[c.key])}
                              value={typeof ov === "number" ? ov : ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                const next = { ...(fam.installOverrides || {}) };
                                if (raw === "") delete next[c.key];
                                else next[c.key] = parseFloat(raw) || 0;
                                fam.installOverrides = next;
                                setFamVersion((n) => n + 1);
                              }}
                              className={"h-7 w-20 font-mono text-xs" + (typeof ov === "number" ? " border-primary" : "")}
                            />
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </section>

      {/* ================= SECTION 2: CALCULATOR ================= */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">2. Item Pricing Calculator</h3>
        <p className="mb-4 max-w-2xl text-xs text-muted-foreground">
          Enter a quantity, pick a material and scope, and see exactly how the price is built up step by step —
          instead of it being buried in tangled formulas.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr] lg:items-start">
          <Card className="lg:sticky lg:top-28">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-xs font-semibold text-primary">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Item inputs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              <div className="flex items-center justify-between gap-2 border-b border-dashed border-border py-2">
                <Label className="text-xs text-muted-foreground">Material / Family</Label>
                <Select value={calcFam} onValueChange={setCalcFam}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FAM_ORDER.filter((k) => !FAMILIES[k].flag).map((key) => (
                      <SelectItem key={key} value={key}>{FAMILIES[key].name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2 border-b border-dashed border-border py-2">
                <Label className="text-xs text-muted-foreground">Scope</Label>
                <Select value={calcScope} onValueChange={(v) => setCalcScope(v as PricingScope)}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Supply">Supply only</SelectItem>
                    <SelectItem value="Site Activity">Dismantle & Install</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-2 py-2">
                <Label className="text-xs text-muted-foreground">
                  Quantity <span className="text-[11px] text-muted-foreground">({FAMILIES[calcFam].unit})</span>
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="any"
                  value={calcQty}
                  onChange={(e) => setCalcQty(parseFloat(e.target.value) || 0)}
                  className="h-8 w-36 font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>

          <CalcFlow key={famVersion} famKey={calcFam} scope={calcScope} qty={calcQty} settings={settings} />
        </div>
      </section>

      {/* ================= SECTION 3: FULL BOQ ================= */}
      <section>
        <h3 className="mb-2 text-sm font-semibold">3. Full BOQ Table</h3>
        <p className="mb-4 max-w-2xl text-xs text-muted-foreground">
          The exact same project items (74 items) with their sub-sections — quantity and material are editable,
          and unit price and total recalculate instantly.
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search by item number or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[220px] flex-1"
          />
          <Select value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              <SelectItem value="supply">Supply & fabrication only</SelectItem>
              <SelectItem value="install">Dismantle & install only</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <BoqTable key={famVersion} items={items} settings={settings} search={search} filter={filter} onUpdate={updateItem} />

        <Card className="mt-5 flex flex-row items-center justify-between p-4">
          <span className="text-sm font-semibold">Project grand total</span>
          <span className="font-mono text-lg font-bold text-warning">{fmt(totals.grand)} EGP</span>
        </Card>

        {!canExport && (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Exporting a priced workbook from this tool requires the Scrap & Material export permission.
          </p>
        )}
      </section>

      <p className="max-w-4xl text-[11px] leading-relaxed text-muted-foreground">
        <b className="text-foreground">Note:</b> this reorganizes the pricing logic from the original Excel file
        into something understandable and editable — not a literal, formula-for-formula copy. Supply items are very
        close to the original sheet; dismantle & install items differ a bit more, since the original sheet varied
        crane, scaffolding and labor-hour rates inconsistently from item to item — here they are unified into one
        clear rate per activity type. Items flagged &ldquo;Unpriced&rdquo; were genuinely blank in the original file
        (e.g. crane rails S2.6–S4.6).
      </p>
    </div>
  );
}

function TotalChip({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div
      className={
        highlight
          ? "min-w-[132px] rounded-lg border border-warning bg-warning/10 px-3.5 py-1.5"
          : "min-w-[132px] rounded-lg border border-border bg-card px-3.5 py-1.5"
      }
    >
      <div className="text-[10.5px] text-muted-foreground">{label}</div>
      <div className={highlight ? "font-mono text-base font-semibold text-warning" : "font-mono text-sm font-semibold"}>
        {fmt(value)}
      </div>
    </div>
  );
}

function CalcFlow({
  famKey, scope, qty, settings,
}: { famKey: string; scope: PricingScope; qty: number; settings: PricingSettings }) {
  const fam = FAMILIES[famKey];
  const r = calcItem(qty, famKey, scope, settings);
  const wQty = (Number(qty) || 0) * (fam.weightFactor || 1);
  const isSupply = scope === "Supply";

  const installLinesBase: [string, number][] = isSupply
    ? [
      ["Transport", wQty * installRate(fam, settings, "transportRate")],
      ["Site handling", wQty * installRate(fam, settings, "handlingPerTon")],
      ["Packing & unpacking", wQty * installRate(fam, settings, "packingPerTon")],
    ]
    : [
      ["Transport", wQty * installRate(fam, settings, "transportRate")],
      ["Site handling", wQty * installRate(fam, settings, "handlingPerTon")],
      ["Packing & unpacking", wQty * installRate(fam, settings, "packingPerTon")],
      ["Crane", wQty * installRate(fam, settings, "cranePerTon")],
      ["Scaffolding", wQty * installRate(fam, settings, "scaffoldPerTon")],
      ["Labor hours", wQty * installRate(fam, settings, "manHourPerTon")],
      ["Occupational safety", wQty * installRate(fam, settings, "safetyPerTon")],
      ["Tools & consumables", wQty * installRate(fam, settings, "toolsPerTon")],
      ["Protective equipment", wQty * installRate(fam, settings, "ppePerTon")],
      ["Touch-up paint", wQty * installRate(fam, settings, "touchUpPerTon")],
      ["Welding supervision", wQty * installRate(fam, settings, "weldSurveyorPerTon")],
    ];
  const installLines = fam.weightFactor
    ? ([[`Equivalent weight for calculation (${qty} × ${fam.weightFactor} MT/unit)`, wQty], ...installLinesBase] as [string, number][])
    : installLinesBase;

  const overheadLines: [string, number][] = isSupply
    ? [["None — applies to installation items only", 0]]
    : [
      [`Mobilization / demobilization (${settings.mobDemobPct}%)`, r.mobDemob],
      [`Third-party certificate (${settings.thirdPartyCertPct}%)`, r.thirdParty],
      [`Height factor (${settings.heightFactorPct}%)`, r.heightFactor],
    ];

  const steps: { title: string; value: number; lines: [string, number | null][] }[] = [
    {
      title: "1 — Material cost",
      value: r.materialCost,
      lines: isSupply
        ? [
          ["Material price", r.materialPrice],
          [`+ Handling (${settings.handlingPct}%)`, r.handling],
          [`+ Scrap (${fam.scrapPct}%)`, r.scrap],
        ]
        : [["None — installation item only, no material supply", 0]],
    },
    {
      title: "2 — Fabrication cost",
      value: r.totalFabricationCost,
      lines: isSupply
        ? [
          ["Material cost (from above)", r.materialCost],
          ["+ Welding & forming", r.welding],
          [`+ NDT inspection (${settings.ndtPct}%)`, r.ndt],
          ["+ Painting", r.painting],
        ]
        : [["None — installation item only", 0]],
    },
    {
      title: "3 — Dismantle & installation cost",
      value: r.installDirect + r.installIndirect,
      lines: [...installLines, [`Indirect costs (${settings.installIndirectPct}%)`, r.installIndirect]],
    },
    { title: "4 — Additional costs", value: r.mobDemob + r.thirdParty + r.heightFactor, lines: overheadLines },
    {
      title: "5 — Tax & insurance",
      value:
        r.finalSalePrice -
        (r.supplySalePrice + r.installSale + r.mobDemob + r.thirdParty + r.heightFactor + r.commissioning),
      lines: [
        [`Tax (${settings.taxPct}%)`, null],
        [`Social insurance (${settings.insurancePct}%)`, null],
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      {steps.map((st, idx) => (
        <React.Fragment key={st.title}>
          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="mb-2 flex items-baseline justify-between">
              <b className="text-sm">{st.title}</b>
              <span className="font-mono text-sm font-semibold text-primary">{fmt(st.value)} EGP</span>
            </div>
            {st.lines.map(([label, val]) => (
              <div key={label} className="flex justify-between py-0.5 text-xs text-muted-foreground">
                <span>{label}</span>
                {val !== null && <span className="font-mono text-foreground">{fmt(val)}</span>}
              </div>
            ))}
          </div>
          {idx < steps.length - 1 && <div className="-my-0.5 text-center text-sm text-muted-foreground">↓</div>}
        </React.Fragment>
      ))}
      <div className="-my-0.5 text-center text-sm text-muted-foreground">↓</div>
      <div className="rounded-lg border border-warning bg-warning/10 p-3.5">
        <div className="mb-2 flex items-baseline justify-between">
          <b className="text-sm">Final price</b>
          <span className="font-mono text-lg font-semibold text-warning">{fmt(r.finalSalePrice)} EGP</span>
        </div>
        <div className="flex justify-between py-0.5 text-xs text-muted-foreground">
          <span>Unit price</span>
          <span className="font-mono text-foreground">{fmt2(r.unitPrice)} EGP / {fam.unit}</span>
        </div>
        <div className="flex justify-between py-0.5 text-xs text-muted-foreground">
          <span>Profit margin</span>
          <span className="font-mono text-foreground">{fmt(r.profit)} EGP ({r.profitPct.toFixed(1)}%)</span>
        </div>
      </div>
    </div>
  );
}

function BoqTable({
  items, settings, search, filter, onUpdate,
}: {
  items: BoqItem[];
  settings: PricingSettings;
  search: string;
  filter: "all" | "supply" | "install";
  onUpdate: (id: number, patch: Partial<Pick<BoqItem, "qty" | "fam">>) => void;
}) {
  const needle = search.trim().toLowerCase();
  const sections: ("supply" | "install")[] = filter === "all" ? ["supply", "install"] : [filter];

  return (
    <div className="space-y-5">
      {sections.map((secKey) => {
        let secItems = items.filter((it) => it.sec === secKey);
        if (needle) {
          secItems = secItems.filter(
            (it) => it.no.toLowerCase().includes(needle) || it.desc.toLowerCase().includes(needle)
          );
        }
        if (!secItems.length) return null;

        const secTotal = secItems.reduce((sum, it) => {
          const r = calcItem(it.qty, it.fam, it.scope, settings);
          return r.flag ? sum : sum + r.total;
        }, 0);

        const subs: string[] = [];
        secItems.forEach((it) => { if (!subs.includes(it.sub)) subs.push(it.sub); });

        return (
          <div key={secKey} className="overflow-hidden rounded-lg border border-border">
            <div className="flex items-center justify-between bg-muted/60 px-4 py-3">
              <b className="text-sm">{SECTION_LABEL[secKey]}</b>
              <span className="font-mono text-sm text-warning">{fmt(secTotal)} EGP</span>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit price</TableHead>
                    <TableHead>Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((sub) => (
                    <React.Fragment key={sub}>
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={8} className="bg-card py-2 text-xs font-semibold text-primary">
                          {sub}
                        </TableCell>
                      </TableRow>
                      {secItems.filter((it) => it.sub === sub).map((it) => {
                        const r = calcItem(it.qty, it.fam, it.scope, settings);
                        return (
                          <TableRow key={it.id} className={r.flag ? "bg-destructive/5" : undefined}>
                            <TableCell className="whitespace-nowrap font-mono text-xs">{it.no}</TableCell>
                            <TableCell className="max-w-[280px]">
                              {it.desc}
                              {it.grade && <span className="block text-[10.5px] text-muted-foreground">{it.grade}</span>}
                            </TableCell>
                            <TableCell className="text-xs">{it.scope === "Supply" ? "Supply" : "Install"}</TableCell>
                            <TableCell>
                              <Select value={it.fam} onValueChange={(v) => onUpdate(it.id, { fam: v })}>
                                <SelectTrigger className="h-7 w-40 text-[11.5px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {FAM_ORDER.filter((k) => !FAMILIES[k].flag || k === it.fam).map((key) => (
                                    <SelectItem key={key} value={key}>{FAMILIES[key].name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell className="text-xs">{it.unit}</TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={0}
                                step="any"
                                value={it.qty}
                                onChange={(e) => onUpdate(it.id, { qty: parseFloat(e.target.value) || 0 })}
                                className="h-7 w-20 font-mono text-xs"
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs">{r.flag ? "—" : fmt2(r.unitPrice)}</TableCell>
                            <TableCell className="font-mono text-xs">
                              {r.flag ? (
                                <Badge variant="destructive" className="gap-1">
                                  <AlertTriangle className="h-3 w-3" /> Unpriced
                                </Badge>
                              ) : (
                                fmt(r.total)
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}