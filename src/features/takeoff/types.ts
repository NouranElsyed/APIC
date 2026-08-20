export type PartType = "PLATE" | "HOT_ROLLED" | "CONE" | "PIPE";
export type PartSide = "INTERNAL" | "EXTERNAL";

export interface PartDxfInfo {
  id: string;
  fileName: string;
  filePath: string;
  valid: boolean;
  errorMessage: string | null;
  unitsDetected: string | null;
  areaSqm: number | null;
  bboxWidthMm: number | null;
  bboxHeightMm: number | null;
  outerContourCount: number | null;
  holeCount: number | null;
}

export interface TakeoffPartRow {
  id: string;
  itemNo: number;
  description: string;
  partType: PartType;
  side: PartSide;
  qty: number;
  thicknessMm: number | null;
  geometry: Record<string, unknown>;
  areaFormula: string | null;
  paintSides: number;
  totalArea: number;
  volume: number;
  weightKg: number;
  paintAreaSqm: number;
  buyWeightKg: number | null;
  scrapKg: number | null;
  scrapPct: number | null;
  dxf: PartDxfInfo | null;
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
