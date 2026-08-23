export type NestingJobStatus = "DRAFT" | "READY";

export interface Point {
  x: number;
  y: number;
}

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
  // A hard limit when set (Phase 2B §2): the nesting engine will never
  // open more physical sheets of this definition than this. null/undefined
  // means "not tracked, unlimited to purchase" (PROJECT.md §4).
  availableQty: number | null;
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

export type NestingRunStatus = "PENDING" | "RUNNING" | "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";

export type UnplacedReason =
  | "NO_SOURCE_SHEET"
  | "INSUFFICIENT_SHEET_AREA"
  | "PART_TOO_LARGE"
  | "NO_VALID_PLACEMENT"
  | "INSUFFICIENT_SOURCE_QTY";

export interface UnplacedPartRow {
  takeoffPartId: string;
  itemNo: number;
  material: string;
  thicknessMm: number;
  requiredQty: number;
  placedQty: number;
  remainingQty: number;
  reason: UnplacedReason;
}

// Automatically-calculated purchasing requirement (PROJECT.md §3/§16) — one
// row per source sheet definition actually used by a run.
export interface SourceRequirementRow {
  sourceSheetId: string;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  requiredQty: number;
  availableQty: number | null;
}

// Per material/thickness group shortage (Phase 2B §2/§9): only present when
// every compatible source for that group has a hard availableQty cap and
// that combined cap fell short of true demand.
export interface SourceShortageRow {
  material: string;
  thicknessMm: number;
  requiredSheets: number;
  availableSheets: number;
  shortageSheets: number;
}

// Lightweight run summary — this is what NestingJobDetail.runs contains
// (no sheets/placements). Fetch /api/nesting/runs/[runId] for the full tree.
export interface NestingRunSummary {
  id: string;
  nestingJobId: string;
  status: NestingRunStatus;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  algorithmName: string | null;
  algorithmVersion: string | null;
  partGapMm: number | null;
  marginLeftMm: number | null;
  marginRightMm: number | null;
  marginTopMm: number | null;
  marginBottomMm: number | null;
  totalSheets: number | null;
  totalUsedAreaSqm: number | null;
  totalScrapAreaSqm: number | null;
  overallUtilizationPercent: number | null;
  totalPartsRequired: number | null;
  totalPartsPlaced: number | null;
  totalPartsUnplaced: number | null;
  unplacedPartsJson: UnplacedPartRow[] | null;
  sourceRequirementJson: SourceRequirementRow[] | null;
  sourceShortageJson: SourceShortageRow[] | null;
}

export interface NestingPlacementRow {
  id: string;
  takeoffPartId: string;
  instanceNumber: number;
  xMm: number;
  yMm: number;
  rotationDeg: number;
}

export interface NestingSheetRow {
  id: string;
  sheetNumber: number;
  sourceSheetId: string | null;
  material: string;
  thicknessMm: number;
  widthMm: number;
  lengthMm: number;
  usedAreaSqm: number | null;
  scrapAreaSqm: number | null;
  utilizationPercent: number | null;
  placements: NestingPlacementRow[];
}

// Full detail payload returned by GET /api/nesting/runs/[runId]
export interface NestingRunDetail extends NestingRunSummary {
  sheets: NestingSheetRow[];
  // Real outer/hole polygon geometry per takeoffPartId (already validated,
  // DXF-derived — see dxf.ts), keyed once per distinct part regardless of
  // how many instances are placed. Lets the sheet preview render the
  // ACTUAL part shape instead of a bounding-box rectangle (Phase 2B).
  partGeometryById: Record<string, { outer: Point[]; holes: Point[][] }>;
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
  runs: NestingRunSummary[];
}
