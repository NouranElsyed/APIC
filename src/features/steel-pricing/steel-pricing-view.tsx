"use client";
import * as React from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Ruler } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  DEFAULT_ITEMS, DEFAULT_PROFILES, DEFAULT_SETTINGS, FAMILIES, FAM_ORDER, PROFILE_ROWS, SECTION_LABEL, SETTINGS_META,
} from "./steel-pricing-data";
import { calcBoq, calcItem, defaultRateMap, fmt, fmt2, profileValue, resolveRates } from "./steel-pricing-engine";
import type {
  BoqItem, InstallProfiles, ItemRateMap, PricingResult, PricingScope, PricingSettings, ProfileId, ProfileKey,
} from "./types";

const PROFILE_IDS: ProfileId[] = ["A", "B", "C", "D", "E"];
const EXTRA_PROFILE_IDS = ["B", "C", "D", "E"] as const;

const SETTINGS_STORAGE_KEY = "steelflow_pricing_settings_v1";
const ITEMS_STORAGE_KEY = "steelflow_pricing_items_v2";
const PROFILES_STORAGE_KEY = "steelflow_pricing_profiles_v1";

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
  const saved = loadFromStorage<Pick<BoqItem, "id" | "qty" | "fam" | "rates">[]>(ITEMS_STORAGE_KEY);
  if (!saved || saved.length !== DEFAULT_ITEMS.length) return DEFAULT_ITEMS;
  return DEFAULT_ITEMS.map((it, i) =>
    saved[i] && saved[i].id === it.id ? { ...it, qty: saved[i].qty, fam: saved[i].fam, rates: saved[i].rates ?? it.rates } : it
  );
}

function initialProfiles(): InstallProfiles {
  const saved = loadFromStorage<InstallProfiles>(PROFILES_STORAGE_KEY);
  if (!saved) return DEFAULT_PROFILES;
  return {
    B: { ...DEFAULT_PROFILES.B, ...saved.B }, C: { ...DEFAULT_PROFILES.C, ...saved.C },
    D: { ...DEFAULT_PROFILES.D, ...saved.D }, E: { ...DEFAULT_PROFILES.E, ...saved.E },
  };
}

export function SteelPricingView({ canExport }: { canExport: boolean }) {
  const [settings, setSettings] = React.useState<PricingSettings>(initialSettings);
  const [items, setItems] = React.useState<BoqItem[]>(initialItems);
  const [profiles, setProfiles] = React.useState<InstallProfiles>(initialProfiles);
  // Bumped whenever a material rate (stored in FAMILIES) changes, so memos recompute
  const [famVersion, setFamVersion] = React.useState(0);

  // Calculator tab state
  const [calcFam, setCalcFam] = React.useState("st37");
  const [calcScope, setCalcScope] = React.useState<PricingScope>("Supply");
  const [calcQty, setCalcQty] = React.useState(10);
  const [calcProfile, setCalcProfile] = React.useState<ProfileId>("A");

  // BOQ tab state
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<"all" | "supply" | "install">("all");

  React.useEffect(() => {
    saveToStorage(SETTINGS_STORAGE_KEY, settings);
  }, [settings]);

  React.useEffect(() => {
    saveToStorage(ITEMS_STORAGE_KEY, items.map((it) => ({ id: it.id, qty: it.qty, fam: it.fam, rates: it.rates })));
  }, [items]);

  React.useEffect(() => {
    saveToStorage(PROFILES_STORAGE_KEY, profiles);
  }, [profiles]);

  function updateProfile(id: (typeof EXTRA_PROFILE_IDS)[number], key: ProfileKey, value: number) {
    setProfiles((p) => ({ ...p, [id]: { ...p[id], [key]: value } }));
  }

  function updateSetting(key: keyof PricingSettings, value: number) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function updateItem(id: number, patch: Partial<Pick<BoqItem, "qty" | "fam" | "rates">>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }

  // Prices the whole BOQ once; everything below reads from this.
  const results = React.useMemo(
    () => calcBoq(items, settings, profiles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, settings, profiles, famVersion],
  );

  const totals = React.useMemo(() => {
    let supplyTotal = 0, installTotal = 0;
    items.forEach((it) => {
      const r = results[it.id];
      const t = r.flag ? 0 : r.total;
      if (it.sec === "supply") supplyTotal += t; else installTotal += t;
    });
    return { supplyTotal, installTotal, grand: supplyTotal + installTotal };
  }, [items, results]);

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
          <h4 className="mb-1 text-xs font-semibold">Install rate profiles</h4>
          <p className="mb-2 max-w-3xl text-xs text-muted-foreground">
            Site handling, crane, scaffolding and labor hours are not the same for every item — the original sheet keeps
            several rate sets and each item picks one per line. <b>A</b> is the standard rate (edited in the
            &ldquo;Installation cost&rdquo; card above); <b>B–E</b> are extra sets you can edit here. Each BOQ item chooses
            its profile per line (open a row in the BOQ table to see and change it).
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-muted/40">
            <Table className="min-w-[720px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Cost line</TableHead>
                  <TableHead>A · Standard</TableHead>
                  {EXTRA_PROFILE_IDS.map((id) => <TableHead key={id}>{id}</TableHead>)}
                  <TableHead>Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {PROFILE_ROWS.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="whitespace-nowrap font-medium">{row.label}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{fmt2(settings[row.key])}</TableCell>
                    {EXTRA_PROFILE_IDS.map((id) => (
                      <TableCell key={id}>
                        <Input
                          type="number"
                          step="any"
                          value={profiles[id][row.key]}
                          onChange={(e) => updateProfile(id, row.key, parseFloat(e.target.value) || 0)}
                          className={"h-7 w-24 font-mono text-xs" + (profiles[id][row.key] !== settings[row.key] ? " border-primary" : "")}
                        />
                      </TableCell>
                    ))}
                    <TableCell className="text-[11px] text-muted-foreground">{row.suffix}</TableCell>
                  </TableRow>
                ))}
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
              <div className="flex items-center justify-between gap-2 border-b border-dashed border-border py-2">
                <Label className="text-xs text-muted-foreground">Install rate profile</Label>
                <Select value={calcProfile} onValueChange={(v) => setCalcProfile(v as ProfileId)}>
                  <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROFILE_IDS.map((id) => (
                      <SelectItem key={id} value={id}>{id === "A" ? "A · Standard" : `Profile ${id}`}</SelectItem>
                    ))}
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

          <CalcFlow key={famVersion} famKey={calcFam} scope={calcScope} qty={calcQty} settings={settings} profiles={profiles} profile={calcProfile} />
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

        <BoqTable items={items} results={results} settings={settings} profiles={profiles} search={search} filter={filter} onUpdate={updateItem} />

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
  famKey, scope, qty, settings, profiles, profile,
}: {
  famKey: string; scope: PricingScope; qty: number; settings: PricingSettings;
  profiles: InstallProfiles; profile: ProfileId;
}) {
  const fam = FAMILIES[famKey];
  const rateMap = defaultRateMap(scope, profile);
  const r = calcItem(qty, famKey, scope, settings, rateMap, profiles);
  const rates = resolveRates(settings, profiles, rateMap);
  const wQty = (Number(qty) || 0) * (fam.weightFactor || 1);
  const isSupply = scope === "Supply";

  const installLinesBase: [string, number][] = PROFILE_ROWS
    .filter((row) => rateMap[row.key] && row.suffix !== "%")
    .map((row) => [row.label, wQty * rates[row.key]]);
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
      lines: [...installLines, [`Indirect costs (${rates.installIndirectPct}%)`, r.installIndirect]],
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

const RATE_KEY_LABEL: Record<ProfileKey, string> = Object.fromEntries(
  PROFILE_ROWS.map((r) => [r.key, r.label]),
) as Record<ProfileKey, string>;

/** Stage-by-stage "how was this price built" strip for one item. */
function BuildUp({ r, unit }: { r: PricingResult; unit: string }) {
  const overheads = r.mobDemob + r.thirdParty + r.heightFactor + r.commissioning;
  const beforeTax = r.supplySalePrice + r.installSale + overheads;
  const taxIns = r.finalSalePrice - beforeTax;
  const stages: { label: string; value: number; hint: string }[] = [
    { label: "Material", value: r.materialCost, hint: "price + handling + scrap" },
    { label: "Fabrication", value: r.welding + r.ndt + r.painting, hint: "welding + NDT + painting" },
    { label: "Dismantle / install", value: r.installDirect + r.installIndirect, hint: "site rates + indirect" },
    { label: "Overheads", value: overheads, hint: "mob/demob + certificate + …" },
    { label: "Tax & insurance", value: taxIns, hint: "on the sale price" },
  ];
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-primary">Price build-up</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {stages.map((st, i) => (
          <div key={st.label} className="rounded-md border border-border bg-card p-2">
            <div className="text-[10.5px] text-muted-foreground">{i + 1}. {st.label}</div>
            <div className="font-mono text-sm font-semibold">{fmt(st.value)}</div>
            <div className="text-[10px] text-muted-foreground">{st.hint}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md border border-warning bg-warning/10 p-2">
          <div className="text-[10.5px] text-muted-foreground">Final price</div>
          <div className="font-mono text-sm font-semibold text-warning">{fmt(r.finalSalePrice)}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-2">
          <div className="text-[10.5px] text-muted-foreground">Unit price</div>
          <div className="font-mono text-sm font-semibold">{fmt2(r.unitPrice)} / {unit}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-2">
          <div className="text-[10.5px] text-muted-foreground">Total cost</div>
          <div className="font-mono text-sm font-semibold">{fmt(r.totalCost)}</div>
        </div>
        <div className="rounded-md border border-border bg-card p-2">
          <div className="text-[10.5px] text-muted-foreground">Profit</div>
          <div className="font-mono text-sm font-semibold">{fmt(r.profit)} ({r.profitPct.toFixed(1)}%)</div>
        </div>
      </div>
    </div>
  );
}

/** Per-item install rate profile picker: shows every install cost line and which profile it uses. */
function ItemRates({
  item, settings, profiles, onChange,
}: {
  item: BoqItem; settings: PricingSettings; profiles: InstallProfiles;
  onChange: (rates: ItemRateMap) => void;
}) {
  const map: ItemRateMap = item.rates || defaultRateMap(item.scope);
  const rows = PROFILE_ROWS.filter((row) => item.scope !== "Supply" || row.suffix === "%" || ["transportRate", "handlingPerTon", "packingPerTon"].includes(row.key));
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-primary">Install rates for this item</div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        {rows.map((row) => {
          const id = map[row.key];
          const val = id ? profileValue(id, row.key, settings, profiles) : 0;
          return (
            <div key={row.key} className="flex items-center justify-between gap-2 border-b border-dashed border-border py-1">
              <span className="text-xs text-muted-foreground">{RATE_KEY_LABEL[row.key]}</span>
              <div className="flex items-center gap-2">
                <span className="w-20 text-right font-mono text-xs">{fmt2(val)}</span>
                <Select
                  value={id || "none"}
                  onValueChange={(v) => {
                    const next = { ...map };
                    if (v === "none") delete next[row.key]; else next[row.key] = v as ProfileId;
                    onChange(next);
                  }}
                >
                  <SelectTrigger className="h-7 w-24 text-[11.5px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not charged</SelectItem>
                    {PROFILE_IDS.map((p) => <SelectItem key={p} value={p}>{p === "A" ? "A · Standard" : `Profile ${p}`}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BoqTable({
  items, results, settings, profiles, search, filter, onUpdate,
}: {
  items: BoqItem[];
  results: Record<number, PricingResult>;
  settings: PricingSettings;
  profiles: InstallProfiles;
  search: string;
  filter: "all" | "supply" | "install";
  onUpdate: (id: number, patch: Partial<Pick<BoqItem, "qty" | "fam" | "rates">>) => void;
}) {
  const needle = search.trim().toLowerCase();
  const sections: ("supply" | "install")[] = filter === "all" ? ["supply", "install"] : [filter];
  const [open, setOpen] = React.useState<number | null>(null);

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
          const r = results[it.id];
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
              <Table className="min-w-[980px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Item No.</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Material</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Unit price</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead>Profit %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {subs.map((sub) => {
                    const subItems = secItems.filter((it) => it.sub === sub);
                    const subTotal = subItems.reduce((sum, it) => {
                      const r = results[it.id];
                      return r.flag ? sum : sum + r.total;
                    }, 0);
                    return (
                      <React.Fragment key={sub}>
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={7} className="bg-card py-2 text-xs font-semibold text-primary">{sub}</TableCell>
                          <TableCell colSpan={2} className="bg-card py-2 font-mono text-xs font-semibold">{fmt(subTotal)}</TableCell>
                        </TableRow>
                        {subItems.map((it) => {
                          const r = results[it.id];
                          const isOpen = open === it.id;
                          return (
                            <React.Fragment key={it.id}>
                              <TableRow
                                className={(r.flag ? "bg-destructive/5 " : "") + "cursor-pointer"}
                                onClick={() => setOpen(isOpen ? null : it.id)}
                              >
                                <TableCell className="w-8 px-2">
                                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </TableCell>
                                <TableCell className="whitespace-nowrap font-mono text-xs">{it.no}</TableCell>
                                <TableCell className="max-w-[280px]">
                                  {it.desc}
                                  {it.grade && <span className="block text-[10.5px] text-muted-foreground">{it.grade}</span>}
                                  {r.linkedTo && (
                                    <span className="block text-[10.5px] text-primary">
                                      {r.linkedTo === "fixed" ? "Fixed unit price" : `Priced like ${r.linkedTo}${it.priceLike && it.priceLike.factor !== 1 ? ` × ${it.priceLike.factor}` : ""}`}
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell onClick={(e) => e.stopPropagation()}>
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
                                <TableCell onClick={(e) => e.stopPropagation()}>
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
                                <TableCell className="font-mono text-xs">{r.flag ? "—" : `${r.profitPct.toFixed(1)}%`}</TableCell>
                              </TableRow>
                              {isOpen && !r.flag && (
                                <TableRow className="hover:bg-transparent">
                                  <TableCell colSpan={9} className="bg-muted/30 p-4">
                                    {r.linkedTo ? (
                                      <p className="text-xs text-muted-foreground">
                                        {r.linkedTo === "fixed"
                                          ? "This item uses a fixed unit price from the original sheet, so it has no cost build-up."
                                          : `This item takes its unit price from item ${r.linkedTo}${it.priceLike && it.priceLike.factor !== 1 ? ` × ${it.priceLike.factor}` : ""}, exactly like the original sheet. Change that item and this one follows.`}
                                      </p>
                                    ) : (
                                      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
                                        <BuildUp r={r} unit={it.unit} />
                                        <ItemRates
                                          item={it}
                                          settings={settings}
                                          profiles={profiles}
                                          onChange={(rates) => onUpdate(it.id, { rates })}
                                        />
                                      </div>
                                    )}
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        );
      })}
    </div>
  );
}