/**
 * Segmentation Phase 8 — the export bundle.
 *
 *   <part>-S01.dxf …            one DXF per piece: the CUT geometry at the origin (layer CUT)
 *   <part>-assembly.dxf         how the finished pieces reconstruct the original, with seams and labels
 *   <part>-segmentation-report.xlsx   original, pieces, assembly positions, seams, mating edges, allowances
 *
 * Everything is derived from the same `Plan` the preview draws, so the files cannot disagree with it.
 */
import type { Group } from "../nest-boost/engine";
import { pieceName } from "./commit";
import { assemblyDxf, segmentDxf } from "./dxf-write";
import type { Plan } from "./planner";
import { overlapText, reportData, segmentationReportBytes, type PieceInfo, type ReportPart } from "./report";
import type { Region } from "./types";
import { buildZip, type ZipEntry } from "./zip";

export interface BundleInput {
  parent: ReportPart & Pick<Group, "name">;
  original: Region;
  plan: Plan;
  /** Fixed time for the zip entries and the report (tests). */
  now?: Date;
  /** Write the finished outline and a label into each piece file, on their own layers (default: no). */
  annotations?: boolean;
}

export interface Bundle {
  files: ZipEntry[];
  zip: Uint8Array;
  zipName: string;
  pieces: PieceInfo[];
}

/** A file-name-safe version of a part name: no path separators or characters Windows rejects. */
export function safeFileName(name: string): string {
  const s = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, " ").trim().replace(/^\.+/, "").slice(0, 100);
  return s || "part";
}

export async function buildBundle(a: BundleInput): Promise<Bundle> {
  const now = a.now ?? new Date();
  const base = safeFileName(a.parent.name);
  const used = new Set<string>();
  const unique = (n: string) => {
    let out = n;
    for (let i = 2; used.has(out.toLowerCase()); i++) out = `${n}_${i}`;
    used.add(out.toLowerCase());
    return out;
  };

  const fileNames: Record<string, string> = {};
  const files: ZipEntry[] = [];
  for (const s of a.plan.segments) {
    const file = `${unique(safeFileName(pieceName(a.parent.name, s.id)))}.dxf`;
    fileNames[s.id] = file;
    files.push({ name: file, data: segmentDxf(s, { annotations: a.annotations, label: s.id }) });
  }

  const n = a.plan.segments.length;
  const title = [
    `${a.parent.name} - ${n} segment${n === 1 ? "" : "s"} x ${Math.max(0, Math.round(a.parent.qty))} pc`,
    `Allowance: ${overlapText(a.plan.input.overlap)}`,
    "Finished geometry. Seams on layer SEAMS, original outline on layer ORIGINAL.",
  ];
  files.push({ name: `${unique(`${base}-assembly`)}.dxf`, data: assemblyDxf({ original: a.original, plan: a.plan, title }) });

  const generatedAt = now.toISOString().slice(0, 16).replace("T", " ");
  const input = { parent: a.parent, original: a.original, plan: a.plan, generatedAt, fileNames };
  files.push({ name: `${unique(`${base}-segmentation-report`)}.xlsx`, data: await segmentationReportBytes(input) });

  return { files, zip: buildZip(files, now), zipName: `${base}-segmentation.zip`, pieces: reportData(input).pieces };
}
