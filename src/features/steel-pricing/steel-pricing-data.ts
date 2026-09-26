import type { BoqItem, InstallKey, MaterialTable, RateBook } from "./types";

/**
 * Defaults generated from `Cost Estimation- Steel Structure.xlsx` (sheet "BOQ - Full").
 * Rate profiles A–E are the workbook's five alternative rate-card rows (15,14,13,12,11).
 * Values are the workbook's evaluated numbers (e.g. ST-37 = 46000/1.14).
 */
export const DEFAULT_RATES: RateBook = {
  "handling": {
    "A": 0.015
  },
  "scrap": {
    "A": 0.07,
    "B": 0.02,
    "C": 0.05,
    "D": 0.02
  },
  "accessories": {
    "A": 0.03,
    "B": 0.01
  },
  "cutting": {
    "A": 6000
  },
  "welding": {
    "A": 16000,
    "B": 4250,
    "C": 31300,
    "D": 33300,
    "E": 19000
  },
  "painting": {
    "A": 12500,
    "B": 22930,
    "C": 8250,
    "D": 10795,
    "E": 10000
  },
  "paintingArea": {},
  "fabIndirect": {
    "A": 0.0025,
    "B": 0.005
  },
  "ndt": {
    "A": 0.04
  },
  "margins": {
    "material": 1.1,
    "fabrication": 1.29,
    "ndt": 1.1,
    "painting": 1.2
  },
  "install": {
    "transport": {
      "A": 1000,
      "B": 3640
    },
    "handling": {
      "A": 200,
      "B": 800,
      "C": 600,
      "D": 400,
      "E": 1000
    },
    "packing": {
      "A": 100,
      "B": 30
    },
    "crane": {
      "A": 2800,
      "B": 4200,
      "C": 6200,
      "D": 5200,
      "E": 7500
    },
    "scaffolding": {
      "A": 1120,
      "B": 3800,
      "C": 2400,
      "D": 14500,
      "E": 5200
    },
    "manHour": {
      "A": 3000,
      "B": 4500,
      "C": 9250,
      "D": 12500,
      "E": 7500
    },
    "safety": {
      "A": 150,
      "B": 600,
      "C": 300
    },
    "tools": {
      "A": 300,
      "B": 420,
      "C": 2400,
      "D": 1200,
      "E": 3200
    },
    "ppe": {
      "A": 150,
      "B": 0
    },
    "touchUp": {
      "A": 100
    },
    "weldSurveyor": {
      "A": 700,
      "B": 3200,
      "C": 6500,
      "D": 1200,
      "E": 4200
    }
  },
  "installIndirect": {
    "A": 0.005,
    "B": 0.02
  },
  "installMargin": {
    "A": 1.1,
    "B": 1.2,
    "C": 1.2
  },
  "mobDemob": 0.08,
  "heightFactor": 0,
  "thirdParty": 0.002,
  "commissioning": 0,
  "tax": {
    "A": 0.99,
    "B": 0.97
  },
  "insurance": {
    "A": 0.9505,
    "B": 1
  },
  "rateLabels": {}
};

/** Materials keyed by their rate-card row in the workbook. */
export const DEFAULT_MATERIALS: MaterialTable = {
  "1": {
    "label": "Louvers",
    "unit": "SQM",
    "price": 4650
  },
  "2": {
    "label": "Ladder",
    "unit": "MT",
    "price": 43500
  },
  "3": {
    "label": "Handrail 18 kg",
    "unit": "MT",
    "price": 55000
  },
  "4": {
    "label": "Anchor bolt",
    "unit": "MT",
    "price": 108695.65217391305
  },
  "5": {
    "label": "Bolt 8.8",
    "unit": "MT",
    "price": 120370.37037037036
  },
  "6": {
    "label": "Poly sheet",
    "unit": "SQM",
    "price": 610
  },
  "7": {
    "label": "Steps",
    "unit": "PCS",
    "price": 1100
  },
  "8": {
    "label": "Grating",
    "unit": "SQM",
    "price": 3130
  },
  "9": {
    "label": "Corrugated sheets",
    "unit": "SQM",
    "price": 450
  },
  "10": {
    "label": "Purlins",
    "unit": "MT",
    "price": 44736.84210526316
  },
  "11": {
    "label": "Checkered plate",
    "unit": "MT",
    "price": 46491.22807017544
  },
  "12": {
    "label": "ST-52 (light sections)",
    "unit": "MT",
    "price": 46491.22807017544
  },
  "13": {
    "label": "ST-52 (heavy sections)",
    "unit": "MT",
    "price": 51491.22807017544
  },
  "14": {
    "label": "ST-44",
    "unit": "MT",
    "price": 45614.035087719305
  },
  "15": {
    "label": "ST-37",
    "unit": "MT",
    "price": 40350.87719298246
  }
};

export const MATERIAL_ORDER = [15, 14, 12, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

export const INSTALL_LABEL: Record<InstallKey, string> = {
  transport: "Transportation",
  handling: "Handling / Ton",
  packing: "Packing & Unpacking",
  crane: "Crane / Ton",
  scaffolding: "Scaffolding / Ton",
  manHour: "Man Hour / Ton",
  safety: "Safety",
  tools: "Tools & Consumables",
  ppe: "PPE & Safety",
  touchUp: "Touch-up Paint",
  weldSurveyor: "Welding & Surveyor",
};

export const SECTION_LABEL: Record<"supply" | "install", string> = {
  supply: "Supply & Fabrication",
  install: "Dismantle & Reinstall / Install",
};

/** The 74-item BOQ exactly as structured in the workbook (calculated, priced-like, fixed and unpriced items). */
export const DEFAULT_ITEMS: BoqItem[] = [
  {"no": "S1.1", "sec": "supply", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Supply", "desc": "New steel structure (HRS, BUS & Purlins)", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 25, "mode": "calc", "spec": {"unitWt": 0, "matRow": 14, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": "A", "painting": "A", "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "handling": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S1.2", "sec": "supply", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Supply", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 2700, "mode": "calc", "spec": {"unitWt": 0.0079, "matRow": 9, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": true}, "handling": {"p": "A", "k": 1.0, "wt": true}, "packing": {"p": "A", "k": 1.0, "wt": true}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S1.3", "sec": "supply", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Supply", "desc": "Bolts & Nuts Gr 8.8/10.9 DIN933", "grade": "Gr 8.8/10.9", "unit": "MT", "qty": 1, "mode": "calc", "spec": {"unitWt": 0, "matRow": 5, "handling": true, "scrap": null, "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "handling": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S2.1", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "New steel structure (HRS, BUS)", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 1400, "mode": "calc", "spec": {"unitWt": 0, "matRow": 13, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": "A", "painting": "A", "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "B", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S2.2", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "New purlins & side girts (Z & C sections)", "grade": "S235JR/S355JR", "unit": "MT", "qty": 34, "mode": "calc", "spec": {"unitWt": 0, "matRow": 10, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": "B", "painting": "B", "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S2.3", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 8000, "mode": "calc", "spec": {"unitWt": 0.0079, "matRow": 9, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": true}, "handling": {"p": "A", "k": 1.0, "wt": true}, "packing": {"p": "A", "k": 1.0, "wt": true}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S2.4", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "Columns anchorage (Anchor Frames & Anchor Bolts)", "grade": "S355JR", "unit": "MT", "qty": 55, "mode": "calc", "spec": {"unitWt": 0, "matRow": 4, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S2.5", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "Bolts & Nuts Gr 8.8/10.9 DIN933", "grade": "Gr 8.8/10.9", "unit": "MT", "qty": 55, "mode": "pricedLike", "like": {"src": "S1.3", "mult": 1.0}},
  {"no": "S2.6", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "Crane Rails A120 (incl. clips, bolts & rubber pads)", "grade": "DIN536/1", "unit": "LM", "qty": 120, "mode": "unpriced"},
  {"no": "S2.7", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "Crane Rails A100 (incl. clips, bolts & rubber pads)", "grade": "DIN536/1", "unit": "LM", "qty": 120, "mode": "unpriced"},
  {"no": "S2.8", "sec": "supply", "sub": "02 New Melt Shop (New Building)", "scope": "Supply", "desc": "Crane Rails A65 (incl. clips, bolts & rubber pads)", "grade": "DIN536/1", "unit": "LM", "qty": 75, "mode": "unpriced"},
  {"no": "S3.1", "sec": "supply", "sub": "03 Existing Scrap Yard (Dismantled & Relocated)", "scope": "Supply", "desc": "New steel structure (HRS, BUS & Purlins)", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 45, "mode": "pricedLike", "like": {"src": "S1.1", "mult": 1.0}},
  {"no": "S3.2", "sec": "supply", "sub": "03 Existing Scrap Yard (Dismantled & Relocated)", "scope": "Supply", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 8000, "mode": "pricedLike", "like": {"src": "S1.2", "mult": 1.0}},
  {"no": "S3.3", "sec": "supply", "sub": "03 Existing Scrap Yard (Dismantled & Relocated)", "scope": "Supply", "desc": "Bolts & Nuts Gr 8.8/10.9 DIN933", "grade": "Gr 8.8/10.9", "unit": "MT", "qty": 1, "mode": "pricedLike", "like": {"src": "S1.3", "mult": 1.0}},
  {"no": "S3.4", "sec": "supply", "sub": "03 Existing Scrap Yard (Dismantled & Relocated)", "scope": "Supply", "desc": "Anchor bolts (out of rods)", "grade": "S355JR", "unit": "MT", "qty": 18, "mode": "fixed", "fixed": 125000},
  {"no": "S4.1", "sec": "supply", "sub": "04 New Scrap Yard Extension (New Building)", "scope": "Supply", "desc": "New steel structure (HRS, BUS & Purlins)", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 300, "mode": "pricedLike", "like": {"src": "S1.1", "mult": 1.0}},
  {"no": "S4.2", "sec": "supply", "sub": "04 New Scrap Yard Extension (New Building)", "scope": "Supply", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 4000, "mode": "pricedLike", "like": {"src": "S2.3", "mult": 1.0}},
  {"no": "S4.3", "sec": "supply", "sub": "04 New Scrap Yard Extension (New Building)", "scope": "Supply", "desc": "Bolts & Nuts Gr 8.8/10.9 DIN933", "grade": "Gr 8.8/10.9", "unit": "MT", "qty": 6, "mode": "pricedLike", "like": {"src": "S1.3", "mult": 1.0}},
  {"no": "S4.4", "sec": "supply", "sub": "04 New Scrap Yard Extension (New Building)", "scope": "Supply", "desc": "New purlins & side girts (Z & C sections)", "grade": "S355JR", "unit": "MT", "qty": 20, "mode": "pricedLike", "like": {"src": "S2.2", "mult": 1.0}},
  {"no": "S4.5", "sec": "supply", "sub": "04 New Scrap Yard Extension (New Building)", "scope": "Supply", "desc": "Anchor bolts (out of rods)", "grade": "S355JR", "unit": "MT", "qty": 10, "mode": "pricedLike", "like": {"src": "S3.4", "mult": 1.0}},
  {"no": "S4.6", "sec": "supply", "sub": "04 New Scrap Yard Extension (New Building)", "scope": "Supply", "desc": "Crane Rails A100 (incl. clips, bolts & rubber pads)", "grade": "DIN536/1", "unit": "LM", "qty": 120, "mode": "unpriced"},
  {"no": "S11.01", "sec": "supply", "sub": "11 New Mould Repair Shop", "scope": "Supply", "desc": "New steel structure (HRS, BUS & Purlins)", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 400, "mode": "pricedLike", "like": {"src": "S1.1", "mult": 1.0}},
  {"no": "S11.02", "sec": "supply", "sub": "11 New Mould Repair Shop", "scope": "Supply", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 8000, "mode": "pricedLike", "like": {"src": "S1.2", "mult": 1.0}},
  {"no": "S11.03", "sec": "supply", "sub": "11 New Mould Repair Shop", "scope": "Supply", "desc": "Bolts & Nuts Gr 8.8/10.9 DIN933", "grade": "Gr 8.8/10.9", "unit": "MT", "qty": 1, "mode": "pricedLike", "like": {"src": "S3.3", "mult": 1.0}},
  {"no": "S11.04", "sec": "supply", "sub": "11 New Mould Repair Shop", "scope": "Supply", "desc": "Anchor bolts (out of rods)", "grade": "S235JR", "unit": "MT", "qty": 6, "mode": "fixed", "fixed": 125000},
  {"no": "S12.1", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Ladder (L or U profiles)", "grade": "S235JR", "unit": "MT", "qty": 30, "mode": "calc", "spec": {"unitWt": 0, "matRow": 2, "handling": true, "scrap": "A", "accessories": "A", "cutting": null, "welding": "C", "painting": "C", "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S12.2", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Handrail (welded pipes)", "grade": "S235JR", "unit": "MT", "qty": 50, "mode": "calc", "spec": {"unitWt": 0, "matRow": 3, "handling": true, "scrap": "A", "accessories": "B", "cutting": null, "welding": "D", "painting": "D", "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S12.3", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Stairs (U profiles)", "grade": "S235JR", "unit": "MT", "qty": 150, "mode": "calc", "spec": {"unitWt": 0, "matRow": 14, "handling": true, "scrap": "A", "accessories": "A", "cutting": null, "welding": "E", "painting": "A", "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S12.4", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Checkered plates (t=6/8mm)", "grade": "S235JR", "unit": "MT", "qty": 15, "mode": "calc", "spec": {"unitWt": 0, "matRow": 11, "handling": true, "scrap": "C", "accessories": null, "cutting": "A", "welding": null, "painting": "E", "ndt": true, "fabIndirect": "A", "install": {"transport": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S12.5", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Grating (34x38mm mesh, bearing bar 30x3, crossbar 6mm)", "grade": "S235JR", "unit": "SQM", "qty": 500, "mode": "calc", "spec": {"unitWt": 0.03, "matRow": 8, "handling": true, "scrap": "D", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"transport": {"p": "A", "k": 0.03, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S12.6", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Grating treads (34x38mm mesh, w=30cm)", "grade": "S235JR", "unit": "EA", "qty": 500, "mode": "calc", "spec": {"unitWt": 0.01, "matRow": 7, "handling": true, "scrap": null, "accessories": "B", "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"transport": {"p": "A", "k": 0.01, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S12.7", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Polycarbonate sheets (t=1mm)", "grade": "Polycarbonate", "unit": "SQM", "qty": 600, "mode": "calc", "spec": {"unitWt": 0.008, "matRow": 6, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"transport": {"p": "A", "k": 0.008, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "S12.8", "sec": "supply", "sub": "12 Miscellaneous", "scope": "Supply", "desc": "Louvers (1000x2000mm, t=1mm)", "grade": "S235JR", "unit": "SQM", "qty": 500, "mode": "calc", "spec": {"unitWt": 0.04, "matRow": 1, "handling": true, "scrap": "B", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"transport": {"p": "A", "k": 0.04, "wt": false}}, "installIndirect": "A", "installMargin": "A", "mob": false, "height": false, "thirdParty": false, "commissioning": false, "tax": "A", "insurance": "B"}},
  {"no": "I1.1", "sec": "install", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Site Activity", "desc": "Dismantle old steel structure", "grade": "S235JR", "unit": "MT", "qty": 200, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": true, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": true, "fabIndirect": "A", "install": {"handling": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "B", "k": 1.0, "wt": false}, "crane": {"p": "A", "k": 1.0, "wt": false}, "scaffolding": {"p": "A", "k": 1.0, "wt": false}, "manHour": {"p": "A", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I1.2", "sec": "install", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Site Activity", "desc": "Dismantle old cladding sheets", "grade": "S235JR", "unit": "SQM", "qty": 2700, "mode": "calc", "spec": {"unitWt": 0.0079, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "A", "k": 1.0, "wt": true}, "packing": {"p": "B", "k": 1.0, "wt": true}, "crane": {"p": "B", "k": 1.0, "wt": true}, "scaffolding": {"p": "B", "k": 1.0, "wt": true}, "manHour": {"p": "D", "k": 1.0, "wt": true}, "safety": {"p": "B", "k": 1.0, "wt": true}, "tools": {"p": "B", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I1.3", "sec": "install", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Site Activity", "desc": "Surface preparation & repaint of dismantled steel structure", "grade": "\u2014", "unit": "MT", "qty": 160, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"handling": {"p": "B", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A", "paintingRate": 7750, "paintingMargin": 1.15}},
  {"no": "I1.4", "sec": "install", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Site Activity", "desc": "Reinstall of steel structure", "grade": "S235JR", "unit": "MT", "qty": 160, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "C", "k": 1.0, "wt": false}, "packing": {"p": "B", "k": 1.0, "wt": false}, "crane": {"p": "A", "k": 1.0, "wt": false}, "scaffolding": {"p": "C", "k": 1.0, "wt": false}, "manHour": {"p": "B", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I1.5", "sec": "install", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Site Activity", "desc": "New purlins & side girts (Z & C sections)", "grade": "S235JR/S355JR", "unit": "MT", "qty": 25, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "B", "k": 1.0, "wt": false}, "packing": {"p": "A", "k": 1.0, "wt": false}, "crane": {"p": "A", "k": 1.0, "wt": false}, "scaffolding": {"p": "B", "k": 1.0, "wt": false}, "manHour": {"p": "C", "k": 1.0, "wt": false}, "safety": {"p": "B", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I1.6", "sec": "install", "sub": "01 Existing Melt-shop (End Gable & End Girts)", "scope": "Site Activity", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 2700, "mode": "calc", "spec": {"unitWt": 0.0079, "matRow": null, "handling": false, "scrap": null, "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"handling": {"p": "A", "k": 1.0, "wt": true}, "packing": {"p": "A", "k": 1.0, "wt": true}, "crane": {"p": "B", "k": 1.0, "wt": true}, "scaffolding": {"p": "B", "k": 1.0, "wt": true}, "manHour": {"p": "D", "k": 1.0, "wt": true}, "safety": {"p": "A", "k": 1.0, "wt": true}, "tools": {"p": "A", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A", "scrapLink": {"item": "S1.2", "profile": "C"}}},
  {"no": "I2.1", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "New steel structure (H, I, U & L + Hollow + BUS)", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 1400, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "D", "k": 1.0, "wt": false}, "crane": {"p": "B", "k": 1.0, "wt": false}, "scaffolding": {"p": "B", "k": 1.0, "wt": false}, "manHour": {"p": "B", "k": 1.0, "wt": false}, "safety": {"p": "C", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "C", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I2.2", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "Anchorage frames (plates & rods)", "grade": "S355JR", "unit": "MT", "qty": 55, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "A", "k": 1.0, "wt": false}, "manHour": {"p": "C", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I2.3", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "New rails A120 (incl. accessories)", "grade": "DIN536/1", "unit": "LM", "qty": 120, "mode": "calc", "spec": {"unitWt": 0.1, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "D", "k": 1.0, "wt": true}, "packing": {"p": "A", "k": 1.0, "wt": true}, "crane": {"p": "B", "k": 1.0, "wt": true}, "scaffolding": {"p": "D", "k": 1.0, "wt": true}, "manHour": {"p": "B", "k": 1.0, "wt": true}, "safety": {"p": "B", "k": 1.0, "wt": true}, "tools": {"p": "C", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}, "weldSurveyor": {"p": "B", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "C", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I2.4", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "New rails A100 (incl. accessories)", "grade": "DIN536/1", "unit": "LM", "qty": 120, "mode": "calc", "spec": {"unitWt": 0.075, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "D", "k": 1.0, "wt": true}, "packing": {"p": "A", "k": 1.0, "wt": true}, "crane": {"p": "B", "k": 1.0, "wt": true}, "scaffolding": {"p": "D", "k": 1.0, "wt": true}, "manHour": {"p": "B", "k": 1.0, "wt": true}, "safety": {"p": "B", "k": 1.0, "wt": true}, "tools": {"p": "C", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}, "weldSurveyor": {"p": "B", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "C", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I2.5", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "New rails A65 (incl. accessories)", "grade": "DIN536/1", "unit": "LM", "qty": 75, "mode": "calc", "spec": {"unitWt": 0.045, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "D", "k": 1.0, "wt": true}, "packing": {"p": "A", "k": 1.0, "wt": true}, "crane": {"p": "B", "k": 1.0, "wt": true}, "scaffolding": {"p": "D", "k": 1.0, "wt": true}, "manHour": {"p": "B", "k": 1.0, "wt": true}, "safety": {"p": "B", "k": 1.0, "wt": true}, "tools": {"p": "C", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}, "weldSurveyor": {"p": "B", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "C", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I2.6", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "New purlins & side girts (Z & C sections)", "grade": "S235JR/S355JR", "unit": "MT", "qty": 34, "mode": "pricedLike", "like": {"src": "I1.5", "mult": 1.0}},
  {"no": "I2.7", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "Bolts & Nuts Gr 8.8/10.9 DIN933", "grade": "Gr 8.8/10.9", "unit": "MT", "qty": 55, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "B", "k": 1.0, "wt": false}, "manHour": {"p": "D", "k": 1.5, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "C", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I2.8", "sec": "install", "sub": "02 New Melt Shop Extension", "scope": "Site Activity", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 8000, "mode": "pricedLike", "like": {"src": "I1.6", "mult": 1.1}},
  {"no": "I3.1", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Dismantle old steel structure", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 600, "mode": "pricedLike", "like": {"src": "I1.1", "mult": 1.0}},
  {"no": "I3.2", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Dismantle old rails", "grade": "DIN536/1", "unit": "LM", "qty": 220, "mode": "calc", "spec": {"unitWt": 0.075, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "A", "k": 1.0, "wt": false}, "crane": {"p": "A", "k": 1.0, "wt": true}, "scaffolding": {"p": "D", "k": 0.5, "wt": true}, "manHour": {"p": "B", "k": 1.0, "wt": true}, "safety": {"p": "A", "k": 1.0, "wt": true}, "tools": {"p": "A", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "C", "mob": true, "height": true, "thirdParty": false, "commissioning": false, "tax": "B", "insurance": "A"}},
  {"no": "I3.3", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Dismantle old cladding sheets", "grade": "S235JR", "unit": "SQM", "qty": 8000, "mode": "pricedLike", "like": {"src": "I1.2", "mult": 1.0}},
  {"no": "I3.4", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Surface preparation & repaint of dismantled steel structure", "grade": "\u2014", "unit": "MT", "qty": 500, "mode": "pricedLike", "like": {"src": "I1.3", "mult": 1.0}},
  {"no": "I3.5", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Reinstall of steel structure", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 500, "mode": "pricedLike", "like": {"src": "I1.4", "mult": 1.0}},
  {"no": "I3.6", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Columns modification (30 pcs)", "grade": "S235JR/S355JR", "unit": "MT", "qty": 15, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "B", "k": 1.0, "wt": false}, "crane": {"p": "B", "k": 1.0, "wt": false}, "manHour": {"p": "D", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "E", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "C", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I3.7", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Anchor bolts (out of rods)", "grade": "S355JR", "unit": "MT", "qty": 19, "mode": "pricedLike", "like": {"src": "I2.2", "mult": 1.0}},
  {"no": "I3.8", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "Reinstall rails A100 (incl. accessories)", "grade": "DIN536/1", "unit": "LM", "qty": 220, "mode": "calc", "spec": {"unitWt": 0.075, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "A", "k": 1.0, "wt": false}, "crane": {"p": "A", "k": 1.0, "wt": true}, "scaffolding": {"p": "D", "k": 0.5, "wt": true}, "manHour": {"p": "B", "k": 1.0, "wt": true}, "safety": {"p": "A", "k": 1.0, "wt": true}, "tools": {"p": "A", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}, "weldSurveyor": {"p": "B", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "C", "mob": true, "height": true, "thirdParty": false, "commissioning": false, "tax": "B", "insurance": "A"}},
  {"no": "I3.9", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "New St. Str and purlins & side girts (Z & C sections)", "grade": "S355JR", "unit": "MT", "qty": 45, "mode": "pricedLike", "like": {"src": "I1.5", "mult": 1.0}},
  {"no": "I3.10", "sec": "install", "sub": "03 Existing Scrap Yard (Relocation \u2013 5 Axes)", "scope": "Site Activity", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 8000, "mode": "pricedLike", "like": {"src": "I1.6", "mult": 1.0}},
  {"no": "I4.1", "sec": "install", "sub": "04 New Scrap Yard Extension (2 Axes)", "scope": "Site Activity", "desc": "New steel structure (H, I, U & L + Hollow + BUS)", "grade": "S235JR/S275JR/S355JR", "unit": "MT", "qty": 300, "mode": "pricedLike", "like": {"src": "I1.4", "mult": 1.0}},
  {"no": "I4.2", "sec": "install", "sub": "04 New Scrap Yard Extension (2 Axes)", "scope": "Site Activity", "desc": "Anchor bolts (out of rods)", "grade": "S355JR", "unit": "MT", "qty": 16, "mode": "pricedLike", "like": {"src": "I3.7", "mult": 1.0}},
  {"no": "I4.3", "sec": "install", "sub": "04 New Scrap Yard Extension (2 Axes)", "scope": "Site Activity", "desc": "New rails A100 (incl. accessories)", "grade": "DIN536/1", "unit": "LM", "qty": 120, "mode": "pricedLike", "like": {"src": "I2.4", "mult": 1.0}},
  {"no": "I4.4", "sec": "install", "sub": "04 New Scrap Yard Extension (2 Axes)", "scope": "Site Activity", "desc": "New purlins & side girts (Z & C sections)", "grade": "S355JR", "unit": "MT", "qty": 20, "mode": "pricedLike", "like": {"src": "I1.5", "mult": 1.0}},
  {"no": "I4.5", "sec": "install", "sub": "04 New Scrap Yard Extension (2 Axes)", "scope": "Site Activity", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 4000, "mode": "pricedLike", "like": {"src": "I3.10", "mult": 1.0}},
  {"no": "I11.1", "sec": "install", "sub": "11 New Mould Repair Shop", "scope": "Site Activity", "desc": "New steel structure (H, I, U & L + Hollow + BUS)", "grade": "S235JR/S355JR", "unit": "MT", "qty": 400, "mode": "pricedLike", "like": {"src": "I4.1", "mult": 1.0}},
  {"no": "I11.2", "sec": "install", "sub": "11 New Mould Repair Shop", "scope": "Site Activity", "desc": "Anchor bolts (out of rods)", "grade": "S235JR", "unit": "MT", "qty": 7, "mode": "pricedLike", "like": {"src": "I4.2", "mult": 1.0}},
  {"no": "I11.3", "sec": "install", "sub": "11 New Mould Repair Shop", "scope": "Site Activity", "desc": "New purlins & side girts (Z & C sections)", "grade": "S235JR", "unit": "MT", "qty": 10, "mode": "pricedLike", "like": {"src": "I3.9", "mult": 1.0}},
  {"no": "I11.4", "sec": "install", "sub": "11 New Mould Repair Shop", "scope": "Site Activity", "desc": "New cladding sheets (t=0.7mm)", "grade": "S235JR", "unit": "SQM", "qty": 8000, "mode": "pricedLike", "like": {"src": "I4.5", "mult": 1.0}},
  {"no": "I12.1", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Ladder (L or U profiles)", "grade": "S235JR", "unit": "MT", "qty": 30, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "A", "k": 1.0, "wt": false}, "packing": {"p": "B", "k": 1.0, "wt": false}, "crane": {"p": "A", "k": 1.0, "wt": false}, "scaffolding": {"p": "A", "k": 1.0, "wt": false}, "manHour": {"p": "C", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "D", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I12.2", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Handrail (welded pipes)", "grade": "S235JR", "unit": "MT", "qty": 50, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "C", "k": 1.0, "wt": false}, "packing": {"p": "B", "k": 1.0, "wt": false}, "crane": {"p": "B", "k": 1.0, "wt": false}, "scaffolding": {"p": "A", "k": 1.0, "wt": false}, "manHour": {"p": "D", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "B", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I12.3", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Stairs (U profiles)", "grade": "S235JR", "unit": "MT", "qty": 20, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "B", "k": 1.0, "wt": false}, "packing": {"p": "B", "k": 1.0, "wt": false}, "crane": {"p": "B", "k": 1.0, "wt": false}, "scaffolding": {"p": "B", "k": 1.0, "wt": false}, "manHour": {"p": "D", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "C", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "D", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I12.4", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Checkered plates (t=6/8mm)", "grade": "S235JR", "unit": "MT", "qty": 15, "mode": "calc", "spec": {"unitWt": 0, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "B", "k": 1.0, "wt": false}, "packing": {"p": "B", "k": 1.0, "wt": false}, "crane": {"p": "B", "k": 1.0, "wt": false}, "scaffolding": {"p": "B", "k": 1.0, "wt": false}, "manHour": {"p": "D", "k": 1.0, "wt": false}, "safety": {"p": "A", "k": 1.0, "wt": false}, "tools": {"p": "A", "k": 1.0, "wt": false}, "ppe": {"p": "A", "k": 1.0, "wt": false}, "touchUp": {"p": "A", "k": 1.0, "wt": false}, "weldSurveyor": {"p": "C", "k": 1.0, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I12.5", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Grating (34x38mm mesh, bearing bar 30x3, crossbar 6mm)", "grade": "S235JR", "unit": "SQM", "qty": 500, "mode": "calc", "spec": {"unitWt": 0.03, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "B", "k": 1.0, "wt": true}, "packing": {"p": "B", "k": 1.0, "wt": true}, "crane": {"p": "D", "k": 1.0, "wt": true}, "scaffolding": {"p": "B", "k": 1.0, "wt": true}, "manHour": {"p": "C", "k": 1.0, "wt": true}, "safety": {"p": "A", "k": 1.0, "wt": true}, "tools": {"p": "A", "k": 1.0, "wt": true}, "ppe": {"p": "A", "k": 1.0, "wt": true}, "weldSurveyor": {"p": "D", "k": 1.0, "wt": true}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I12.6", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Grating treads (34x38mm mesh, w=30cm)", "grade": "S235JR", "unit": "EA", "qty": 500, "mode": "calc", "spec": {"unitWt": 0.01, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": null, "install": {"handling": {"p": "E", "k": 1.0, "wt": true}, "packing": {"p": "B", "k": 0.01, "wt": false}, "crane": {"p": "A", "k": 0.01, "wt": false}, "manHour": {"p": "D", "k": 0.01, "wt": false}, "safety": {"p": "A", "k": 0.01, "wt": false}, "tools": {"p": "B", "k": 0.01, "wt": false}, "ppe": {"p": "A", "k": 0.01, "wt": false}, "weldSurveyor": {"p": "D", "k": 0.01, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A"}},
  {"no": "I12.7", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Polycarbonate sheets (t=1mm)", "grade": "Polycarbonate", "unit": "SQM", "qty": 600, "mode": "calc", "spec": {"unitWt": 0.015, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"handling": {"p": "E", "k": 1.0, "wt": true}, "packing": {"p": "A", "k": 1.0, "wt": true}, "crane": {"p": "E", "k": 1.0, "wt": true}, "scaffolding": {"p": "D", "k": 1.0, "wt": true}, "manHour": {"p": "D", "k": 1.0, "wt": true}, "safety": {"p": "A", "k": 0.01, "wt": false}, "tools": {"p": "A", "k": 0.01, "wt": false}, "ppe": {"p": "A", "k": 0.01, "wt": false}, "weldSurveyor": {"p": "E", "k": 0.01, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A", "accessoriesLink": {"item": "S12.7", "k": 0.1}}},
  {"no": "I12.8", "sec": "install", "sub": "12 Miscellaneous", "scope": "Site Activity", "desc": "Louvers (1000x2000mm, t=1mm)", "grade": "S235JR", "unit": "SQM", "qty": 500, "mode": "calc", "spec": {"unitWt": 0.05, "matRow": null, "handling": false, "scrap": "A", "accessories": null, "cutting": null, "welding": null, "painting": null, "ndt": false, "fabIndirect": "B", "install": {"handling": {"p": "E", "k": 1.0, "wt": true}, "packing": {"p": "B", "k": 1.0, "wt": true}, "crane": {"p": "D", "k": 1.0, "wt": true}, "scaffolding": {"p": "E", "k": 0.05, "wt": false}, "manHour": {"p": "D", "k": 0.05, "wt": false}, "safety": {"p": "A", "k": 0.05, "wt": false}, "tools": {"p": "D", "k": 0.05, "wt": false}, "ppe": {"p": "A", "k": 0.05, "wt": false}, "touchUp": {"p": "A", "k": 0.05, "wt": false}, "weldSurveyor": {"p": "E", "k": 0.05, "wt": false}}, "installIndirect": "B", "installMargin": "B", "mob": true, "height": true, "thirdParty": true, "commissioning": true, "tax": "B", "insurance": "A", "accessoriesLink": {"item": "S12.8", "k": 0.1}}},
];
