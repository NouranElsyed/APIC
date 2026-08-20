export type NestingJobStatus = "DRAFT" | "READY";

export type ExcludedReason =
  | "DXF missing"
  | "DXF invalid"
  | "Invalid geometry"
  | "Quantity is 0"
  | "Missing material"
  | "Missing thickness";

export interface NestingDrawingRef {
  id: string;
  drawingNumber: string;
  title: string;
}

export interface EligiblePart {
  id: string;
  itemNo: number;
  description: string;
  partType: string;
  material: string;
  thicknessMm: number;
  qty: number;
  dxfAreaSqm: number | null;
  bboxWidthMm: number | null;
  bboxHeightMm: number | null;
  drawing: NestingDrawingRef;
}

export interface ExcludedPart {
  id: string;
  itemNo: number;
  description: string;
  qty: number;
  reason: ExcludedReason;
  detail: string | null;
  drawing: NestingDrawingRef;
}

export interface NestingGroup {
  key: string;
  material: string;
  thicknessMm: number;
  partCount: number;
  totalPcs: number;
  parts: EligiblePart[];
}

export interface EligibleNestingParts {
  included: EligiblePart[];
  excluded: ExcludedPart[];
  groups: NestingGroup[];
  totalParts: number;
  totalPcs: number;
}

export interface GroupCoverage {
  key: string;
  material: string;
  thicknessMm: number;
  totalPcs: number;
  covered: boolean;
}

export interface NestingSourceRow {
  id: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  availableQty: number;
  createdAt: string;
}

// Summary shown on the collapsed job-list row — cheap to compute, avoids
// pulling the full eligible-parts payload for every job just to render a list.
export interface NestingJobPartsSummary {
  totalParts: number;
  totalPcs: number;
  excludedCount: number;
  groupCount: number;
}

export interface NestingJobRow {
  id: string;
  projectId: string;
  name: string;
  material: string | null;
  thicknessMm: number | null;
  status: NestingJobStatus;
  createdAt: string;
  sources: NestingSourceRow[];
  partsSummary: NestingJobPartsSummary;
}

// Full detail payload returned by GET /api/nesting/jobs/[id]
export interface NestingJobDetail {
  id: string;
  projectId: string;
  name: string;
  material: string | null;
  thicknessMm: number | null;
  status: NestingJobStatus;
  createdAt: string;
  sources: NestingSourceRow[];
  eligible: EligibleNestingParts;
  coverage: GroupCoverage[];
}
