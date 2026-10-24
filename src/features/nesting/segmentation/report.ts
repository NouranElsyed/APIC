/**
 * Segmentation Phase 8 — the segmentation report.
 *
 * Identifies, for every piece: the original part, the segment id and its DXF file, quantity, where it
 * goes in the finished part (assembly position), which pieces it mates with and along which seam,
 * and the overlap / gap applied. `reportData` is pure; `segmentationWorkbook` writes it as Excel in
 * the same style as the app's other reports.
 *
 * Coordinates are in the ORIGINAL part's own system (the origin is the lower-left corner of its
 * bounding box, like every part in the nest). "Assembly X/Y" is where the lower-left corner of the
 * piece's FINISHED outline sits; "Cut X/Y" where the lower-left corner of the piece that is CUT sits
 * (they differ when an overlap or a gap is used).
 */
import ExcelJS from "exceljs";
import { addKeyValues, addTable, addTitle, stamp, type Cell, type Col } from "../report/excel-common";
import type { Group } from "../nest-boost/engine";
import { pieceName } from "./commit";
import { cutOrigin, finishedOrigin } from "./dxf-write";
import { loopBBox, regionArea } from "./geometry";
import type { OverlapSpec, Plan, PlanSeam } from "./planner";
import type { Region } from "./types";

export type ReportPart = Pick<Group, "name" | "qty" | "th" | "material" | "w" | "h" | "area">;

export interface ReportInput {
  parent: ReportPart;
  /** The original part's exact geometry (the region the plan was built from). */
  original: Region;
  plan: Plan;
  /** Text for "Generated" (default: now). Tests pass a fixed value. */
  generatedAt?: string;
  /** Per-segment DXF file names (default: `<piece name>.dxf`). */
  fileNames?: Record<string, string>;
}

export interface MatingEdge {
  seam: string;
  cut: string;
  kind: "strip" | "transverse";
  /** The segment on the other side of the seam. */
  with: string;
  /** The seam line, e.g. "y = 1490". */
  line: string;
  lengthMm: number;
  /** Signed mm applied to THIS piece at this seam: + extends (overlap), − cut back (gap), 0 none. */
  appliedMm: number;
}

export interface PieceInfo {
  id: string;
  name: string;
  file: string;
  qty: number;
  strip: number;
  cell: number;
  /** Size of the piece that is CUT, and of the FINISHED piece (they differ when an overlap or gap is used). */
  cutW: number;
  cutH: number;
  finishedW: number;
  finishedH: number;
  finishedAreaM2: number;
  cutAreaM2: number;
  areaChangeM2: number;
  fit: string;
  solo: boolean;
  finishedX: number;
  finishedY: number;
  cutX: number;
  cutY: number;
  mating: MatingEdge[];
}

export interface ReportData {
  summary: [string, Cell][];
  pieces: PieceInfo[];
  seams: { seam: PlanSeam; appliedA: number; appliedB: number }[];
  /** Finished segments' total area minus the original's, mm² (≈ 0 when they reassemble to the part). */
  reassemblyDiffMm2: number;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const m2 = (mm2: number) => r3(mm2 / 1e6);

export function overlapText(o: OverlapSpec): string {
  if (!o.enabled || !o.mm) return "none";
  const side = o.side === "A" ? "lower-coordinate segment" : o.side === "alternate" ? "alternating segments" : "both segments, half each";
  return o.mm > 0 ? `Overlap +${o.mm} mm (carried by ${side})` : `Gap ${o.mm} mm (cut back on ${side})`;
}

/** Signed mm applied to one side of a seam: + overlap, − gap. */
export function appliedAt(o: OverlapSpec, seam: PlanSeam, role: "low" | "high"): number {
  if (!o.enabled || !o.mm || !seam.carrier) return 0;
  const w = Math.abs(o.mm);
  const amount = seam.carrier === "both" ? w / 2 : seam.carrier === role ? w : 0;
  return amount === 0 ? 0 : amount * Math.sign(o.mm); // never -0
}

export function reportData(a: ReportInput): ReportData {
  const { parent, plan } = a;
  const o = plan.input.overlap;
  const qty = Math.max(0, Math.round(parent.qty));

  const pieces: PieceInfo[] = plan.segments.map((s) => {
    const name = pieceName(parent.name, s.id);
    const cb = loopBBox(s.cut.outer);
    const fb = loopBBox(s.finished.outer);
    const [fx, fy] = finishedOrigin(s);
    const [cx, cy] = cutOrigin(s);
    const mating: MatingEdge[] = plan.seams
      .filter((m) => m.low === s.id || m.high === s.id)
      .map((m) => ({
        seam: m.id,
        cut: m.cutId,
        kind: m.kind,
        with: m.low === s.id ? m.high : m.low,
        line: `${m.axis} = ${r3(m.pos)}`,
        lengthMm: r3(m.length),
        appliedMm: appliedAt(o, m, m.low === s.id ? "low" : "high"),
      }));
    return {
      id: s.id,
      name,
      file: a.fileNames?.[s.id] ?? `${name}.dxf`,
      qty,
      strip: s.cell.strip + 1,
      cell: s.cell.index + 1,
      cutW: r3(cb[2] - cb[0]),
      cutH: r3(cb[3] - cb[1]),
      finishedW: r3(fb[2] - fb[0]),
      finishedH: r3(fb[3] - fb[1]),
      finishedAreaM2: m2(s.finishedArea),
      cutAreaM2: m2(s.cutArea),
      areaChangeM2: m2(s.cutArea - s.finishedArea),
      fit: s.fit.status === "READY" ? "fits" : s.fit.status === "READY_SOLO" ? "solo sheet" : "does not fit",
      solo: s.solo,
      finishedX: r3(fx),
      finishedY: r3(fy),
      cutX: r3(cx),
      cutY: r3(cy),
      mating,
    };
  });

  const seams = plan.seams.map((m) => ({ seam: m, appliedA: appliedAt(o, m, "low"), appliedB: appliedAt(o, m, "high") }));
  const sumFinished = plan.segments.reduce((s, g) => s + g.finishedArea, 0);
  const diff = sumFinished - regionArea(a.original);
  const sheets = plan.input.sheet.sheets.map((s) => `${s.W} × ${s.H}`).join("; ") || "—";
  const cons = plan.input.constraints ?? {};
  const consText =
    [
      cons.minSeamStagger !== undefined && `min seam stagger ${cons.minSeamStagger} mm`,
      cons.minSeamToBoundary !== undefined && `min seam-to-edge ${cons.minSeamToBoundary} mm`,
      cons.maxSeamLength !== undefined && `max seam length ${cons.maxSeamLength} mm`,
      cons.minSegmentMm !== undefined && `min segment ${cons.minSegmentMm} mm`,
      cons.forbidCrossJunctions && "no cross junctions",
    ]
      .filter(Boolean)
      .join("; ") || "none";

  const summary: [string, Cell][] = [
    ["Original part", parent.name],
    ["Quantity of originals", qty],
    ["Thickness (mm)", parent.th || null],
    ["Material", parent.material || null],
    ["Original size (mm)", `${r3(parent.w)} × ${r3(parent.h)}`],
    ["Original area (m²)", m2(regionArea(a.original))],
    ["Segments per original", plan.segments.length],
    ["Pieces to nest (segments × quantity)", plan.segments.length * qty],
    ["Total seam length per original (m)", r3(plan.metrics.cutLength / 1000)],
    ["Direction", plan.input.direction === "H" ? "Horizontal strips" : "Vertical strips"],
    ["Strip cuts / transverse seams", `${plan.input.stripCuts.length} / ${plan.input.seamCuts.length}`],
    ["Overlap / gap", overlapText(o)],
    ["Cuts through holes", plan.input.holePolicy === "reject" ? "rejected" : "allowed after confirmation"],
    ["Seam constraints", consText],
    ["Source sheets (mm)", sheets],
    ["Edge margin / spacing / grid cell (mm)", `${plan.input.sheet.mg} / ${plan.input.sheet.gp ?? "—"} / ${plan.input.sheet.cell ?? "—"}`],
    ["Arc tolerance of the nest polygons (mm)", plan.input.tol ?? 0.1],
    ["Finished area of all segments − original (mm²)", r3(diff)],
    ["Reassembly check", Math.abs(diff) < 0.01 ? "OK: the finished segments reconstruct the original" : "DIFFERENCE: see the area above"],
    ["Generated", a.generatedAt ?? stamp()],
  ];
  return { summary, pieces, seams, reassemblyDiffMm2: diff };
}

const NOTE =
  "Coordinates are in the original part's own system (origin = lower-left corner of its bounding box). " +
  "Assembly X/Y = lower-left corner of the finished outline; Cut X/Y = lower-left corner of the piece that is cut " +
  "(they differ when an overlap or gap is used). Applied: + extends the piece (overlap), − cuts it back (gap).";

export function segmentationWorkbook(a: ReportInput): ExcelJS.Workbook {
  const d = reportData(a);
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const s1 = wb.addWorksheet("Summary");
  let row = addTitle(s1, 1, `Part segmentation — ${a.parent.name}`);
  row = addKeyValues(s1, row + 1, d.summary);
  s1.getColumn(1).width = 46;
  s1.getColumn(2).width = 60;
  addTitle(s1, row + 1, NOTE, 10);

  const s2 = wb.addWorksheet("Segments");
  const cols: Col[] = [
    { header: "Segment", width: 11 },
    { header: "Part name", width: 24 },
    { header: "DXF file", width: 28 },
    { header: "Qty", width: 7 },
    { header: "Strip", width: 7 },
    { header: "Cell", width: 7 },
    { header: "Cut width (mm)", fmt: "#,##0.000" },
    { header: "Cut height (mm)", fmt: "#,##0.000" },
    { header: "Finished width (mm)", fmt: "#,##0.000" },
    { header: "Finished height (mm)", fmt: "#,##0.000" },
    { header: "Finished area (m²)", fmt: "#,##0.000", sum: true },
    { header: "Cut area (m²)", fmt: "#,##0.000", sum: true },
    { header: "Area change (m²)", fmt: "#,##0.000", sum: true },
    { header: "Fit", width: 13 },
    { header: "Assembly X (mm)", fmt: "#,##0.000" },
    { header: "Assembly Y (mm)", fmt: "#,##0.000" },
    { header: "Cut X (mm)", fmt: "#,##0.000" },
    { header: "Cut Y (mm)", fmt: "#,##0.000" },
  ];
  const rows: Cell[][] = d.pieces.map((p) => [
    p.id, p.name, p.file, p.qty, p.strip, p.cell, p.cutW, p.cutH, p.finishedW, p.finishedH, p.finishedAreaM2, p.cutAreaM2, p.areaChangeM2, p.fit,
    p.finishedX, p.finishedY, p.cutX, p.cutY,
  ]);
  const next = addTable(s2, 1, cols, rows, { label: "Total" });
  addTitle(s2, next, NOTE, 10);

  const s3 = wb.addWorksheet("Seams");
  const seamCols: Col[] = [
    { header: "Seam", width: 20 },
    { header: "Cut line", width: 9 },
    { header: "Kind", width: 12 },
    { header: "Line (mm)", width: 14 },
    { header: "Segment A (lower)", width: 16 },
    { header: "Segment B (higher)", width: 16 },
    { header: "Length (mm)", fmt: "#,##0.000", sum: true },
    { header: "Applied to A (mm)", fmt: "0.###" },
    { header: "Applied to B (mm)", fmt: "0.###" },
  ];
  const seamRows: Cell[][] = d.seams.map(({ seam: m, appliedA, appliedB }) => [
    m.id, m.cutId, m.kind === "strip" ? "strip cut" : "seam", `${m.axis} = ${r3(m.pos)}`, m.low, m.high, r3(m.length), appliedA, appliedB,
  ]);
  const seamNext = addTable(s3, 1, seamCols, seamRows, { label: "Total" });
  addTitle(s3, seamNext, "A seam is the joint between two pieces: the cut line and the material along which they are welded.", 10);

  const s4 = wb.addWorksheet("Mating edges");
  const mateCols: Col[] = [
    { header: "Segment", width: 11 },
    { header: "Seam", width: 20 },
    { header: "Mates with", width: 12 },
    { header: "Line (mm)", width: 14 },
    { header: "Length (mm)", fmt: "#,##0.000" },
    { header: "Applied to this piece (mm)", fmt: "0.###" },
  ];
  const mateRows: Cell[][] = d.pieces.flatMap((p) => p.mating.map((e) => [p.id, e.seam, e.with, e.line, e.lengthMm, e.appliedMm] as Cell[]));
  addTable(s4, 1, mateCols, mateRows);
  return wb;
}

export async function segmentationReportBytes(a: ReportInput): Promise<Uint8Array> {
  const buf = await segmentationWorkbook(a).xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}
