export type PartType = "PLATE" | "HOT_ROLLED" | "CONE" | "PIPE" | "ACCESSORY";
export type PartSide = "INTERNAL" | "EXTERNAL" | "BOTH";

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
  unitsWarning: string | null;
}

export interface TakeoffPartRow {
  id: string;
  itemNo: number;
  description: string;
  material: string | null;
  partType: PartType;
  side: PartSide;
  /** assembly this part belongs to (BOQ grouping) */
  groupId: string | null;
  posNo: string | null;
  qtyPerAssembly: number;
  remark: string | null;
  /** link to the part of the project's 2D nest this plate came from */
  nestKind: string | null;
  nestPartId: number | null;
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

/** One entry of the signed-in user's nesting history (an import saved automatically, not yet a project). */
export interface HistoryEntry {
  id: string;
  name: string;
  /** Set once the entry was saved as a project. */
  savedProjectId: string | null;
  createdAt: string;
  updatedAt: string;
}
