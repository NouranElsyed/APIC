import type { BoqItem, InstallProfiles, ItemRateMap, MaterialFamily, PricingSettings, ProfileKey } from "./types";

export const FAMILIES: Record<string, MaterialFamily> = {
  st37: { name: "Main structural steel (ST-37)", unit: "MT", materialPrice: 40351, weldingRate: 16000, paintingRate: 12500, scrapPct: 7 },
  st44: { name: "ST-44 steel", unit: "MT", materialPrice: 45614, weldingRate: 4250, paintingRate: 22930, scrapPct: 2 },
  st52light: { name: "ST-52 steel (light sections)", unit: "MT", materialPrice: 46491, weldingRate: 33300, paintingRate: 10795, scrapPct: 2 },
  st52heavy: { name: "ST-52 steel (heavy sections)", unit: "MT", materialPrice: 51491, weldingRate: 31300, paintingRate: 8250, scrapPct: 5 },
  checkered: { name: "Checkered plate", unit: "MT", materialPrice: 46491, weldingRate: 19000, paintingRate: 10000, scrapPct: 2 },
  purlins: { name: "Purlins", unit: "MT", materialPrice: 44737, weldingRate: 4250, paintingRate: 22930, scrapPct: 2 },
  corrugated: { name: "Cladding sheets", unit: "SQM", materialPrice: 450, weldingRate: 0, paintingRate: 0, scrapPct: 2, weightFactor: 0.0079 },
  grating: { name: "Grating", unit: "SQM", materialPrice: 3130, weldingRate: 0, paintingRate: 0, scrapPct: 2, weightFactor: 0.03 },
  steps: { name: "Steps", unit: "PCS", materialPrice: 1100, weldingRate: 0, paintingRate: 0, scrapPct: 7, weightFactor: 0.01 },
  polysheet: { name: "Polycarbonate sheet", unit: "SQM", materialPrice: 610, weldingRate: 0, paintingRate: 0, scrapPct: 7, weightFactor: 0.008 },
  bolt88: { name: "Bolts & nuts Gr 8.8/10.9", unit: "MT", materialPrice: 120370, weldingRate: 0, paintingRate: 63, scrapPct: 7 },
  anchorbolt: { name: "Anchor bolts", unit: "MT", materialPrice: 108696, weldingRate: 0, paintingRate: 47, scrapPct: 7 },
  handrail: { name: "Handrail", unit: "MT", materialPrice: 55000, weldingRate: 33300, paintingRate: 10795, scrapPct: 2 },
  ladder: { name: "Ladder", unit: "MT", materialPrice: 43500, weldingRate: 31300, paintingRate: 8250, scrapPct: 5 },
  stairs: { name: "Stairs", unit: "MT", materialPrice: 46491, weldingRate: 19000, paintingRate: 10000, scrapPct: 2 },
  louvers: { name: "Louvers", unit: "SQM", materialPrice: 4650, weldingRate: 0, paintingRate: 0, scrapPct: 2, weightFactor: 0.04 },
  rail: { name: "Crane rail", unit: "LM", materialPrice: 3500, weldingRate: 500, paintingRate: 100, scrapPct: 2, weightFactor: 0.1 },
  unpriced: { name: "Unpriced item (gap in the original file)", unit: "—", materialPrice: 0, weldingRate: 0, paintingRate: 0, scrapPct: 0, flag: true },
};

export const FAM_ORDER = [
  "st37", "st44", "st52light", "st52heavy", "checkered", "purlins", "corrugated",
  "grating", "steps", "polysheet", "bolt88", "anchorbolt", "handrail", "ladder",
  "stairs", "louvers", "rail", "unpriced",
] as const;

export const DEFAULT_SETTINGS: PricingSettings = {
  handlingPct: 1.5,
  ndtPct: 4,
  fabIndirectPct: 0.25,
  materialMargin: 10,
  fabMargin: 29,
  ndtMargin: 10,
  paintMargin: 20,
  transportRate: 1000,
  handlingPerTon: 200,
  packingPerTon: 100,
  cranePerTon: 2800,
  scaffoldPerTon: 1120,
  manHourPerTon: 3000,
  safetyPerTon: 150,
  toolsPerTon: 300,
  ppePerTon: 150,
  touchUpPerTon: 100,
  weldSurveyorPerTon: 700,
  installIndirectPct: 0.5,
  installMarginPct: 10,
  mobDemobPct: 8,
  thirdPartyCertPct: 0.2,
  heightFactorPct: 0,
  commissioningPct: 0,
  taxPct: 1.01,
  insurancePct: 5.21,
};

export interface SettingsField {
  key: keyof PricingSettings;
  label: string;
  suffix: string;
}

export interface SettingsGroup {
  key: string;
  title: string;
  fields: SettingsField[];
}

export const SETTINGS_META: SettingsGroup[] = [
  {
    key: "group1",
    title: "Material & fabrication cost",
    fields: [
      { key: "handlingPct", label: "Material handling", suffix: "%" },
      { key: "ndtPct", label: "Non-destructive testing (NDT)", suffix: "%" },
      { key: "fabIndirectPct", label: "Fabrication indirect costs", suffix: "%" },
      { key: "materialMargin", label: "Material profit margin", suffix: "%" },
      { key: "fabMargin", label: "Fabrication profit margin", suffix: "%" },
      { key: "ndtMargin", label: "NDT profit margin", suffix: "%" },
      { key: "paintMargin", label: "Painting profit margin", suffix: "%" },
    ],
  },
  {
    key: "group2",
    title: "Installation cost (per unit)",
    fields: [
      { key: "transportRate", label: "Transport", suffix: "EGP" },
      { key: "handlingPerTon", label: "Site handling", suffix: "EGP" },
      { key: "packingPerTon", label: "Packing & unpacking", suffix: "EGP" },
      { key: "cranePerTon", label: "Crane", suffix: "EGP" },
      { key: "scaffoldPerTon", label: "Scaffolding", suffix: "EGP" },
      { key: "manHourPerTon", label: "Labor hours", suffix: "EGP" },
      { key: "safetyPerTon", label: "Occupational safety", suffix: "EGP" },
      { key: "toolsPerTon", label: "Tools & consumables", suffix: "EGP" },
      { key: "ppePerTon", label: "Personal protective equipment", suffix: "EGP" },
      { key: "touchUpPerTon", label: "Touch-up / repair paint", suffix: "EGP" },
      { key: "weldSurveyorPerTon", label: "Welding supervision & survey", suffix: "EGP" },
      { key: "installIndirectPct", label: "Installation indirect costs", suffix: "%" },
      { key: "installMarginPct", label: "Installation profit margin", suffix: "%" },
    ],
  },
  {
    key: "group3",
    title: "Additional costs (installation items only)",
    fields: [
      { key: "mobDemobPct", label: "Mobilization / demobilization", suffix: "%" },
      { key: "thirdPartyCertPct", label: "Third-party inspection certificate", suffix: "%" },
      { key: "heightFactorPct", label: "Working-at-height factor", suffix: "%" },
      { key: "commissioningPct", label: "Commissioning & handover", suffix: "%" },
    ],
  },
  {
    key: "group4",
    title: "Tax & insurance (all items)",
    fields: [
      { key: "taxPct", label: "Tax", suffix: "%" },
      { key: "insurancePct", label: "Social insurance", suffix: "%" },
    ],
  },
];

export const SECTION_LABEL: Record<"supply" | "install", string> = {
  supply: "Supply & Fabrication",
  install: "Dismantle & Reinstall / Install",
};

// The exact 74-item BOQ from the original pricing sheet.
const RAW_ITEMS: BoqItem[] = [
  { id: 1, sec: "supply", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "S1.1", scope: "Supply", desc: "New steel structure (HRS, BUS & Purlins)", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 25, fam: "st37" },
  { id: 2, sec: "supply", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "S1.2", scope: "Supply", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 2700, fam: "corrugated" },
  { id: 3, sec: "supply", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "S1.3", scope: "Supply", desc: "Bolts & Nuts Gr 8.8/10.9 DIN933", grade: "Gr 8.8/10.9", unit: "MT", qty: 1, fam: "bolt88" },
  { id: 4, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.1", scope: "Supply", desc: "New steel structure (HRS, BUS)", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 1400, fam: "st37" },
  { id: 5, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.2", scope: "Supply", desc: "New purlins & side girts (Z & C sections)", grade: "S235JR/S355JR", unit: "MT", qty: 34, fam: "purlins" },
  { id: 6, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.3", scope: "Supply", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 8000, fam: "corrugated" },
  { id: 7, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.4", scope: "Supply", desc: "Columns anchorage (Anchor Frames & Anchor Bolts)", grade: "S355JR", unit: "MT", qty: 55, fam: "anchorbolt" },
  { id: 8, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.5", scope: "Supply", desc: "Bolts & Nuts Gr 8.8/10.9 DIN933", grade: "Gr 8.8/10.9", unit: "MT", qty: 55, fam: "bolt88" },
  { id: 9, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.6", scope: "Supply", desc: "Crane Rails A120 (incl. clips, bolts & rubber pads)", grade: "DIN536/1", unit: "LM", qty: 120, fam: "unpriced" },
  { id: 10, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.7", scope: "Supply", desc: "Crane Rails A100 (incl. clips, bolts & rubber pads)", grade: "DIN536/1", unit: "LM", qty: 120, fam: "unpriced" },
  { id: 11, sec: "supply", sub: "02 New Melt Shop (New Building)", no: "S2.8", scope: "Supply", desc: "Crane Rails A65 (incl. clips, bolts & rubber pads)", grade: "DIN536/1", unit: "LM", qty: 75, fam: "unpriced" },
  { id: 12, sec: "supply", sub: "03 Existing Scrap Yard (Dismantled & Relocated)", no: "S3.1", scope: "Supply", desc: "New steel structure (HRS, BUS & Purlins)", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 45, fam: "st37" },
  { id: 13, sec: "supply", sub: "03 Existing Scrap Yard (Dismantled & Relocated)", no: "S3.2", scope: "Supply", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 8000, fam: "corrugated" },
  { id: 14, sec: "supply", sub: "03 Existing Scrap Yard (Dismantled & Relocated)", no: "S3.3", scope: "Supply", desc: "Bolts & Nuts Gr 8.8/10.9 DIN933", grade: "Gr 8.8/10.9", unit: "MT", qty: 1, fam: "bolt88" },
  { id: 15, sec: "supply", sub: "03 Existing Scrap Yard (Dismantled & Relocated)", no: "S3.4", scope: "Supply", desc: "Anchor bolts (out of rods)", grade: "S355JR", unit: "MT", qty: 18, fam: "anchorbolt" },
  { id: 16, sec: "supply", sub: "04 New Scrap Yard Extension (New Building)", no: "S4.1", scope: "Supply", desc: "New steel structure (HRS, BUS & Purlins)", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 300, fam: "st37" },
  { id: 17, sec: "supply", sub: "04 New Scrap Yard Extension (New Building)", no: "S4.2", scope: "Supply", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 4000, fam: "corrugated" },
  { id: 18, sec: "supply", sub: "04 New Scrap Yard Extension (New Building)", no: "S4.3", scope: "Supply", desc: "Bolts & Nuts Gr 8.8/10.9 DIN933", grade: "Gr 8.8/10.9", unit: "MT", qty: 6, fam: "bolt88" },
  { id: 19, sec: "supply", sub: "04 New Scrap Yard Extension (New Building)", no: "S4.4", scope: "Supply", desc: "New purlins & side girts (Z & C sections)", grade: "S355JR", unit: "MT", qty: 20, fam: "purlins" },
  { id: 20, sec: "supply", sub: "04 New Scrap Yard Extension (New Building)", no: "S4.5", scope: "Supply", desc: "Anchor bolts (out of rods)", grade: "S355JR", unit: "MT", qty: 10, fam: "anchorbolt" },
  { id: 21, sec: "supply", sub: "04 New Scrap Yard Extension (New Building)", no: "S4.6", scope: "Supply", desc: "Crane Rails A100 (incl. clips, bolts & rubber pads)", grade: "DIN536/1", unit: "LM", qty: 120, fam: "unpriced" },
  { id: 22, sec: "supply", sub: "11 New Mould Repair Shop", no: "S11.01", scope: "Supply", desc: "New steel structure (HRS, BUS & Purlins)", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 400, fam: "st37" },
  { id: 23, sec: "supply", sub: "11 New Mould Repair Shop", no: "S11.02", scope: "Supply", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 8000, fam: "corrugated" },
  { id: 24, sec: "supply", sub: "11 New Mould Repair Shop", no: "S11.03", scope: "Supply", desc: "Bolts & Nuts Gr 8.8/10.9 DIN933", grade: "Gr 8.8/10.9", unit: "MT", qty: 1, fam: "bolt88" },
  { id: 25, sec: "supply", sub: "11 New Mould Repair Shop", no: "S11.04", scope: "Supply", desc: "Anchor bolts (out of rods)", grade: "S235JR", unit: "MT", qty: 6, fam: "anchorbolt" },
  { id: 26, sec: "supply", sub: "12 Miscellaneous", no: "S12.1", scope: "Supply", desc: "Ladder (L or U profiles)", grade: "S235JR", unit: "MT", qty: 30, fam: "ladder" },
  { id: 27, sec: "supply", sub: "12 Miscellaneous", no: "S12.2", scope: "Supply", desc: "Handrail (welded pipes)", grade: "S235JR", unit: "MT", qty: 50, fam: "handrail" },
  { id: 28, sec: "supply", sub: "12 Miscellaneous", no: "S12.3", scope: "Supply", desc: "Stairs (U profiles)", grade: "S235JR", unit: "MT", qty: 150, fam: "stairs" },
  { id: 29, sec: "supply", sub: "12 Miscellaneous", no: "S12.4", scope: "Supply", desc: "Checkered plates (t=6/8mm)", grade: "S235JR", unit: "MT", qty: 15, fam: "checkered" },
  { id: 30, sec: "supply", sub: "12 Miscellaneous", no: "S12.5", scope: "Supply", desc: "Grating (34x38mm mesh, bearing bar 30x3, crossbar 6mm)", grade: "S235JR", unit: "SQM", qty: 500, fam: "grating" },
  { id: 31, sec: "supply", sub: "12 Miscellaneous", no: "S12.6", scope: "Supply", desc: "Grating treads (34x38mm mesh, w=30cm)", grade: "S235JR", unit: "EA", qty: 500, fam: "grating" },
  { id: 32, sec: "supply", sub: "12 Miscellaneous", no: "S12.7", scope: "Supply", desc: "Polycarbonate sheets (t=1mm)", grade: "Polycarbonate", unit: "SQM", qty: 600, fam: "polysheet" },
  { id: 33, sec: "supply", sub: "12 Miscellaneous", no: "S12.8", scope: "Supply", desc: "Louvers (1000x2000mm, t=1mm)", grade: "S235JR", unit: "SQM", qty: 500, fam: "louvers" },
  { id: 34, sec: "install", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "I1.1", scope: "Site Activity", desc: "Dismantle old steel structure", grade: "S235JR", unit: "MT", qty: 200, fam: "st37" },
  { id: 35, sec: "install", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "I1.2", scope: "Site Activity", desc: "Dismantle old cladding sheets", grade: "S235JR", unit: "SQM", qty: 2700, fam: "corrugated" },
  { id: 36, sec: "install", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "I1.3", scope: "Site Activity", desc: "Surface preparation & repaint of dismantled steel structure", grade: "—", unit: "MT", qty: 160, fam: "st37" },
  { id: 37, sec: "install", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "I1.4", scope: "Site Activity", desc: "Reinstall of steel structure", grade: "S235JR", unit: "MT", qty: 160, fam: "st37" },
  { id: 38, sec: "install", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "I1.5", scope: "Site Activity", desc: "New purlins & side girts (Z & C sections)", grade: "S235JR/S355JR", unit: "MT", qty: 25, fam: "purlins" },
  { id: 39, sec: "install", sub: "01 Existing Melt-shop (End Gable & End Girts)", no: "I1.6", scope: "Site Activity", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 2700, fam: "corrugated" },
  { id: 40, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.1", scope: "Site Activity", desc: "New steel structure (H, I, U & L + Hollow + BUS)", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 1400, fam: "st37" },
  { id: 41, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.2", scope: "Site Activity", desc: "Anchorage frames (plates & rods)", grade: "S355JR", unit: "MT", qty: 55, fam: "anchorbolt" },
  { id: 42, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.3", scope: "Site Activity", desc: "New rails A120 (incl. accessories)", grade: "DIN536/1", unit: "LM", qty: 120, fam: "rail" },
  { id: 43, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.4", scope: "Site Activity", desc: "New rails A100 (incl. accessories)", grade: "DIN536/1", unit: "LM", qty: 120, fam: "rail" },
  { id: 44, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.5", scope: "Site Activity", desc: "New rails A65 (incl. accessories)", grade: "DIN536/1", unit: "LM", qty: 75, fam: "rail" },
  { id: 45, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.6", scope: "Site Activity", desc: "New purlins & side girts (Z & C sections)", grade: "S235JR/S355JR", unit: "MT", qty: 34, fam: "purlins" },
  { id: 46, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.7", scope: "Site Activity", desc: "Bolts & Nuts Gr 8.8/10.9 DIN933", grade: "Gr 8.8/10.9", unit: "MT", qty: 55, fam: "bolt88" },
  { id: 47, sec: "install", sub: "02 New Melt Shop Extension", no: "I2.8", scope: "Site Activity", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 8000, fam: "corrugated" },
  { id: 48, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.1", scope: "Site Activity", desc: "Dismantle old steel structure", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 600, fam: "st37" },
  { id: 49, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.2", scope: "Site Activity", desc: "Dismantle old rails", grade: "DIN536/1", unit: "LM", qty: 220, fam: "rail" },
  { id: 50, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.3", scope: "Site Activity", desc: "Dismantle old cladding sheets", grade: "S235JR", unit: "SQM", qty: 8000, fam: "corrugated" },
  { id: 51, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.4", scope: "Site Activity", desc: "Surface preparation & repaint of dismantled steel structure", grade: "—", unit: "MT", qty: 500, fam: "st37" },
  { id: 52, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.5", scope: "Site Activity", desc: "Reinstall of steel structure", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 500, fam: "st37" },
  { id: 53, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.6", scope: "Site Activity", desc: "Columns modification (30 pcs)", grade: "S235JR/S355JR", unit: "MT", qty: 15, fam: "st37" },
  { id: 54, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.7", scope: "Site Activity", desc: "Anchor bolts (out of rods)", grade: "S355JR", unit: "MT", qty: 19, fam: "anchorbolt" },
  { id: 55, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.8", scope: "Site Activity", desc: "Reinstall rails A100 (incl. accessories)", grade: "DIN536/1", unit: "LM", qty: 220, fam: "rail" },
  { id: 56, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.9", scope: "Site Activity", desc: "New St. Str and purlins & side girts (Z & C sections)", grade: "S355JR", unit: "MT", qty: 45, fam: "purlins" },
  { id: 57, sec: "install", sub: "03 Existing Scrap Yard (Relocation – 5 Axes)", no: "I3.10", scope: "Site Activity", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 8000, fam: "corrugated" },
  { id: 58, sec: "install", sub: "04 New Scrap Yard Extension (2 Axes)", no: "I4.1", scope: "Site Activity", desc: "New steel structure (H, I, U & L + Hollow + BUS)", grade: "S235JR/S275JR/S355JR", unit: "MT", qty: 300, fam: "st37" },
  { id: 59, sec: "install", sub: "04 New Scrap Yard Extension (2 Axes)", no: "I4.2", scope: "Site Activity", desc: "Anchor bolts (out of rods)", grade: "S355JR", unit: "MT", qty: 16, fam: "anchorbolt" },
  { id: 60, sec: "install", sub: "04 New Scrap Yard Extension (2 Axes)", no: "I4.3", scope: "Site Activity", desc: "New rails A100 (incl. accessories)", grade: "DIN536/1", unit: "LM", qty: 120, fam: "rail" },
  { id: 61, sec: "install", sub: "04 New Scrap Yard Extension (2 Axes)", no: "I4.4", scope: "Site Activity", desc: "New purlins & side girts (Z & C sections)", grade: "S355JR", unit: "MT", qty: 20, fam: "purlins" },
  { id: 62, sec: "install", sub: "04 New Scrap Yard Extension (2 Axes)", no: "I4.5", scope: "Site Activity", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 4000, fam: "corrugated" },
  { id: 63, sec: "install", sub: "11 New Mould Repair Shop", no: "I11.1", scope: "Site Activity", desc: "New steel structure (H, I, U & L + Hollow + BUS)", grade: "S235JR/S355JR", unit: "MT", qty: 400, fam: "st37" },
  { id: 64, sec: "install", sub: "11 New Mould Repair Shop", no: "I11.2", scope: "Site Activity", desc: "Anchor bolts (out of rods)", grade: "S235JR", unit: "MT", qty: 7, fam: "anchorbolt" },
  { id: 65, sec: "install", sub: "11 New Mould Repair Shop", no: "I11.3", scope: "Site Activity", desc: "New purlins & side girts (Z & C sections)", grade: "S235JR", unit: "MT", qty: 10, fam: "purlins" },
  { id: 66, sec: "install", sub: "11 New Mould Repair Shop", no: "I11.4", scope: "Site Activity", desc: "New cladding sheets (t=0.7mm)", grade: "S235JR", unit: "SQM", qty: 8000, fam: "corrugated" },
  { id: 67, sec: "install", sub: "12 Miscellaneous", no: "I12.1", scope: "Site Activity", desc: "Ladder (L or U profiles)", grade: "S235JR", unit: "MT", qty: 30, fam: "ladder" },
  { id: 68, sec: "install", sub: "12 Miscellaneous", no: "I12.2", scope: "Site Activity", desc: "Handrail (welded pipes)", grade: "S235JR", unit: "MT", qty: 50, fam: "handrail" },
  { id: 69, sec: "install", sub: "12 Miscellaneous", no: "I12.3", scope: "Site Activity", desc: "Stairs (U profiles)", grade: "S235JR", unit: "MT", qty: 20, fam: "stairs" },
  { id: 70, sec: "install", sub: "12 Miscellaneous", no: "I12.4", scope: "Site Activity", desc: "Checkered plates (t=6/8mm)", grade: "S235JR", unit: "MT", qty: 15, fam: "checkered" },
  { id: 71, sec: "install", sub: "12 Miscellaneous", no: "I12.5", scope: "Site Activity", desc: "Grating (34x38mm mesh, bearing bar 30x3, crossbar 6mm)", grade: "S235JR", unit: "SQM", qty: 500, fam: "grating" },
  { id: 72, sec: "install", sub: "12 Miscellaneous", no: "I12.6", scope: "Site Activity", desc: "Grating treads (34x38mm mesh, w=30cm)", grade: "S235JR", unit: "EA", qty: 500, fam: "grating" },
  { id: 73, sec: "install", sub: "12 Miscellaneous", no: "I12.7", scope: "Site Activity", desc: "Polycarbonate sheets (t=1mm)", grade: "Polycarbonate", unit: "SQM", qty: 600, fam: "polysheet" },
  { id: 74, sec: "install", sub: "12 Miscellaneous", no: "I12.8", scope: "Site Activity", desc: "Louvers (1000x2000mm, t=1mm)", grade: "S235JR", unit: "SQM", qty: 500, fam: "louvers" },
];

export const ITEM_PRICE_LINKS: Record<string, { like?: string; factor?: number; fixed?: number }> = { "S2.5": { "like": "S1.3", "factor": 1.0 }, "S3.1": { "like": "S1.1", "factor": 1.0 }, "S3.2": { "like": "S1.2", "factor": 1.0 }, "S3.3": { "like": "S1.3", "factor": 1.0 }, "S3.4": { "fixed": 125000 }, "S4.1": { "like": "S1.1", "factor": 1.0 }, "S4.2": { "like": "S2.3", "factor": 1.0 }, "S4.3": { "like": "S1.3", "factor": 1.0 }, "S4.4": { "like": "S2.2", "factor": 1.0 }, "S4.5": { "like": "S3.4", "factor": 1.0 }, "S11.01": { "like": "S1.1", "factor": 1.0 }, "S11.02": { "like": "S1.2", "factor": 1.0 }, "S11.03": { "like": "S3.3", "factor": 1.0 }, "S11.04": { "fixed": 125000 }, "I2.6": { "like": "I1.5", "factor": 1.0 }, "I2.8": { "like": "I1.6", "factor": 1.1 }, "I3.1": { "like": "I1.1", "factor": 1.0 }, "I3.3": { "like": "I1.2", "factor": 1.0 }, "I3.4": { "like": "I1.3", "factor": 1.0 }, "I3.5": { "like": "I1.4", "factor": 1.0 }, "I3.7": { "like": "I2.2", "factor": 1.0 }, "I3.9": { "like": "I1.5", "factor": 1.0 }, "I3.10": { "like": "I1.6", "factor": 1.0 }, "I4.1": { "like": "I1.4", "factor": 1.0 }, "I4.2": { "like": "I3.7", "factor": 1.0 }, "I4.3": { "like": "I2.4", "factor": 1.0 }, "I4.4": { "like": "I1.5", "factor": 1.0 }, "I4.5": { "like": "I3.10", "factor": 1.0 }, "I11.1": { "like": "I4.1", "factor": 1.0 }, "I11.2": { "like": "I4.2", "factor": 1.0 }, "I11.3": { "like": "I3.9", "factor": 1.0 }, "I11.4": { "like": "I4.5", "factor": 1.0 } };

export const ITEM_RATE_MAPS: Record<string, ItemRateMap> = { "S1.1": { "transportRate": "A", "handlingPerTon": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S1.2": { "transportRate": "A", "handlingPerTon": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S1.3": { "transportRate": "A", "handlingPerTon": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S2.1": { "transportRate": "B", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S2.2": { "transportRate": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S2.3": { "transportRate": "A", "handlingPerTon": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S2.4": { "transportRate": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S2.5": {}, "S2.6": {}, "S2.7": {}, "S2.8": {}, "S3.1": {}, "S3.2": {}, "S3.3": {}, "S3.4": {}, "S4.1": {}, "S4.2": {}, "S4.3": {}, "S4.4": {}, "S4.5": {}, "S4.6": {}, "S11.01": {}, "S11.02": {}, "S11.03": {}, "S11.04": {}, "S12.1": { "transportRate": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S12.2": { "transportRate": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S12.3": { "transportRate": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S12.4": { "transportRate": "A", "packingPerTon": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S12.5": { "transportRate": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S12.6": { "transportRate": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S12.7": { "transportRate": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "S12.8": { "transportRate": "A", "installIndirectPct": "A", "installMarginPct": "A" }, "I1.1": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I1.2": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "B", "scaffoldPerTon": "B", "manHourPerTon": "D", "safetyPerTon": "B", "toolsPerTon": "B", "ppePerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I1.3": { "handlingPerTon": "B", "safetyPerTon": "A", "ppePerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I1.4": { "handlingPerTon": "C", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "C", "manHourPerTon": "B", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I1.5": { "handlingPerTon": "B", "packingPerTon": "A", "cranePerTon": "A", "scaffoldPerTon": "B", "manHourPerTon": "C", "safetyPerTon": "B", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I1.6": { "handlingPerTon": "A", "packingPerTon": "A", "cranePerTon": "B", "scaffoldPerTon": "B", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I2.1": { "handlingPerTon": "D", "cranePerTon": "B", "scaffoldPerTon": "B", "manHourPerTon": "B", "safetyPerTon": "C", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "installIndirectPct": "B", "installMarginPct": "C" }, "I2.2": { "handlingPerTon": "A", "manHourPerTon": "C", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I2.3": { "handlingPerTon": "D", "packingPerTon": "A", "cranePerTon": "B", "scaffoldPerTon": "D", "manHourPerTon": "B", "safetyPerTon": "B", "toolsPerTon": "C", "ppePerTon": "A", "weldSurveyorPerTon": "B", "installIndirectPct": "B", "installMarginPct": "C" }, "I2.4": { "handlingPerTon": "D", "packingPerTon": "A", "cranePerTon": "B", "scaffoldPerTon": "D", "manHourPerTon": "B", "safetyPerTon": "B", "toolsPerTon": "C", "ppePerTon": "A", "weldSurveyorPerTon": "B", "installIndirectPct": "B", "installMarginPct": "C" }, "I2.5": { "handlingPerTon": "D", "packingPerTon": "A", "cranePerTon": "B", "scaffoldPerTon": "D", "manHourPerTon": "B", "safetyPerTon": "B", "toolsPerTon": "C", "ppePerTon": "A", "weldSurveyorPerTon": "B", "installIndirectPct": "B", "installMarginPct": "C" }, "I2.6": {}, "I2.7": { "handlingPerTon": "A", "packingPerTon": "B", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "installIndirectPct": "B", "installMarginPct": "C" }, "I2.8": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I3.1": {}, "I3.2": { "handlingPerTon": "A", "manHourPerTon": "B", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "installIndirectPct": "B", "installMarginPct": "C" }, "I3.3": {}, "I3.4": {}, "I3.5": {}, "I3.6": { "handlingPerTon": "B", "cranePerTon": "B", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "E", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "C", "installIndirectPct": "B", "installMarginPct": "B" }, "I3.7": {}, "I3.8": { "handlingPerTon": "A", "manHourPerTon": "B", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "installIndirectPct": "B", "installMarginPct": "C" }, "I3.9": {}, "I3.10": {}, "I4.1": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I4.2": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I4.3": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I4.4": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I4.5": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I11.1": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I11.2": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I11.3": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I11.4": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "A", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.1": { "handlingPerTon": "A", "packingPerTon": "B", "cranePerTon": "A", "scaffoldPerTon": "A", "manHourPerTon": "C", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.2": { "handlingPerTon": "C", "packingPerTon": "B", "cranePerTon": "B", "scaffoldPerTon": "A", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "B", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.3": { "handlingPerTon": "B", "packingPerTon": "B", "cranePerTon": "B", "scaffoldPerTon": "B", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "C", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "D", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.4": { "handlingPerTon": "B", "packingPerTon": "B", "cranePerTon": "B", "scaffoldPerTon": "B", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "C", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.5": { "handlingPerTon": "B", "packingPerTon": "B", "cranePerTon": "D", "scaffoldPerTon": "B", "manHourPerTon": "C", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "weldSurveyorPerTon": "D", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.6": { "handlingPerTon": "E", "packingPerTon": "B", "cranePerTon": "A", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "B", "ppePerTon": "A", "weldSurveyorPerTon": "D", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.7": { "handlingPerTon": "E", "packingPerTon": "A", "cranePerTon": "E", "scaffoldPerTon": "D", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "A", "ppePerTon": "A", "weldSurveyorPerTon": "E", "installIndirectPct": "B", "installMarginPct": "B" }, "I12.8": { "handlingPerTon": "E", "packingPerTon": "B", "cranePerTon": "D", "scaffoldPerTon": "E", "manHourPerTon": "D", "safetyPerTon": "A", "toolsPerTon": "D", "ppePerTon": "A", "touchUpPerTon": "A", "weldSurveyorPerTon": "E", "installIndirectPct": "B", "installMarginPct": "B" } };

export const DEFAULT_ITEMS: BoqItem[] = RAW_ITEMS.map((it) => {
  const link = ITEM_PRICE_LINKS[it.no];
  return {
    ...it,
    rates: ITEM_RATE_MAPS[it.no],
    ...(link?.like ? { priceLike: { no: link.like, factor: link.factor ?? 1 } } : {}),
    ...(link?.fixed !== undefined ? { fixedUnitPrice: link.fixed } : {}),
  };
});

/** Labels for every cost line a profile controls, in display order. */
export const PROFILE_ROWS: { key: ProfileKey; label: string; suffix: string }[] = [
  { key: "transportRate", label: "Transport", suffix: "EGP/MT" },
  { key: "handlingPerTon", label: "Site handling", suffix: "EGP/MT" },
  { key: "packingPerTon", label: "Packing & unpacking", suffix: "EGP/MT" },
  { key: "cranePerTon", label: "Crane", suffix: "EGP/MT" },
  { key: "scaffoldPerTon", label: "Scaffolding", suffix: "EGP/MT" },
  { key: "manHourPerTon", label: "Labor hours", suffix: "EGP/MT" },
  { key: "safetyPerTon", label: "Occupational safety", suffix: "EGP/MT" },
  { key: "toolsPerTon", label: "Tools & consumables", suffix: "EGP/MT" },
  { key: "ppePerTon", label: "Protective equipment", suffix: "EGP/MT" },
  { key: "touchUpPerTon", label: "Touch-up paint", suffix: "EGP/MT" },
  { key: "weldSurveyorPerTon", label: "Welding supervision", suffix: "EGP/MT" },
  { key: "installIndirectPct", label: "Install indirect costs", suffix: "%" },
  { key: "installMarginPct", label: "Install profit margin", suffix: "%" },
];

const A_BASE: Record<ProfileKey, number> = {
  transportRate: 1000, handlingPerTon: 200, packingPerTon: 100, cranePerTon: 2800, scaffoldPerTon: 1120,
  manHourPerTon: 3000, safetyPerTon: 150, toolsPerTon: 300, ppePerTon: 150, touchUpPerTon: 100,
  weldSurveyorPerTon: 700, installIndirectPct: 0.5, installMarginPct: 10,
};

/** Extra rate sets B–E, taken from the original sheet's rate rows (blank cells fall back to the standard rate). */
export const DEFAULT_PROFILES: InstallProfiles = {
  B: {
    ...A_BASE, transportRate: 3640, handlingPerTon: 800, packingPerTon: 30, cranePerTon: 4200, scaffoldPerTon: 3800,
    manHourPerTon: 4500, safetyPerTon: 600, toolsPerTon: 420, weldSurveyorPerTon: 3200, installIndirectPct: 2, installMarginPct: 20
  },
  C: {
    ...A_BASE, handlingPerTon: 600, cranePerTon: 6200, scaffoldPerTon: 2400, manHourPerTon: 9250, safetyPerTon: 300,
    toolsPerTon: 2400, weldSurveyorPerTon: 6500, installMarginPct: 20
  },
  D: {
    ...A_BASE, handlingPerTon: 400, cranePerTon: 5200, scaffoldPerTon: 14500, manHourPerTon: 12500, toolsPerTon: 1200,
    weldSurveyorPerTon: 1200
  },
  E: {
    ...A_BASE, handlingPerTon: 1000, cranePerTon: 7500, scaffoldPerTon: 5200, manHourPerTon: 7500, toolsPerTon: 3200,
    weldSurveyorPerTon: 4200
  },
};