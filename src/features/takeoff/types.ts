export interface TakeoffPartRow {
  id: string;
  itemNo: number;
  description: string;
  extWidth: number | null;
  extLength: number | null;
  intWidth: number | null;
  intLength: number | null;
  qty: number;
  thicknessMm: number;
  paintSides: number;
  areaMode: "ADD" | "SUBTRACT" | "CUSTOM";
  customFormula: string | null;
  extUnitArea: number;
  intUnitArea: number;
  totalUnitArea: number;
  totalArea: number;
  volume: number;
  weightKg: number;
  paintAreaSqm: number;
  buyWeightKg: number | null;
  scrapKg: number | null;
  scrapPct: number | null;
}

export interface TakeoffDrawingRow {
  id: string;
  drawingNumber: string;
  title: string;
  weightFromDwg: number | null;
  parts: TakeoffPartRow[];
}

export interface ProjectOption {
  id: string;
  name: string;
  number: string;
}
