/**
 * Segmentation Phase 8 — "Export" from the UI: builds the bundle (DXF per piece, assembly drawing,
 * report) and downloads it as one zip. Loaded on demand so the Excel writer is only fetched when used.
 */
import type { Group } from "../nest-boost/engine";
import { savedPlan, segSignature } from "./commit";
import { groupToRegion } from "./group-region";
import { buildPlan, type Plan } from "./planner";
import type { Region } from "./types";

export interface ExportArgs {
  parent: Group;
  original: Region;
  plan: Plan;
  /** Label layers in the piece files (default: no). */
  annotations?: boolean;
}

export interface ExportResult {
  zipName: string;
  pieces: number;
  files: number;
}

export async function exportSegmentation(
  a: ExportArgs,
  /** Replaces the browser download (tests). */
  save?: (blob: Blob, filename: string) => void,
): Promise<ExportResult> {
  if (!a.plan.valid) throw new Error("The layout has errors — fix them before exporting.");
  const [{ buildBundle }, common] = await Promise.all([import("./bundle"), save ? Promise.resolve(null) : import("../report/excel-common")]);
  const b = await buildBundle({ parent: a.parent, original: a.original, plan: a.plan, annotations: a.annotations });
  const blob = new Blob([b.zip as BlobPart], { type: "application/zip" });
  (save ?? common!.saveBlob)(blob, b.zipName);
  return { zipName: b.zipName, pieces: b.pieces.length, files: b.files.length };
}

export type SavedExport = { ok: true; result: ExportResult } | { ok: false; reason: string };

/**
 * Export for an already segmented original (the "Export segments" menu item): rebuilds the plan from the
 * cuts saved on the part — the same inputs as when it was approved, so the same geometry — and exports it.
 * Refuses, with a reason, when there is no saved segmentation, the part changed since, or the plan has errors.
 */
export async function exportSavedSegmentation(parent: Group, save?: (blob: Blob, filename: string) => void): Promise<SavedExport> {
  const saved = savedPlan(parent);
  if (!saved) return { ok: false, reason: "This part has no saved segmentation." };
  if (parent.seg?.sig && parent.seg.sig !== segSignature(parent)) {
    return { ok: false, reason: "The part changed after it was segmented — undo the segmentation and segment it again." };
  }
  const original = groupToRegion(parent).region;
  const plan = buildPlan(original, saved);
  if (!plan.valid) return { ok: false, reason: 'The saved segmentation has errors — open "Edit segmentation" to fix them.' };
  return { ok: true, result: await exportSegmentation({ parent, original, plan }, save) };
}
