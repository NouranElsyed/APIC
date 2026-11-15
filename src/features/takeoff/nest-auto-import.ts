// Fills the Part List with every part of the project's saved 2D nest that is not in it yet (no button needed).
// Same path as the "Take parts from 2D Nesting" dialog: a one-part DXF per nest part goes through the DXF importer,
// and the plate keeps the nest part id (nestPartId) so the two-way quantity sync and duplicate protection work.

import type { TakeoffDrawingRow } from "./types";
import { nestPartDescription, nestPartFileName, nestPartToDxf, parseNestParts } from "./nest-parts";

const NESTING_DRAWING = "NESTING";

export interface AutoImportResult { imported: number; failed: number; }

export async function autoImportNestParts(projectId: string, drawings: TakeoffDrawingRow[]): Promise<AutoImportResult> {
  const none = { imported: 0, failed: 0 };
  const wsRes = await fetch(`/api/nesting/workspace?kind=2D&projectId=${projectId}`).catch(() => null);
  if (!wsRes?.ok) return none;
  const ws = (await wsRes.json().catch(() => null)) as { data?: unknown } | null;

  const linked = new Set(drawings.flatMap((d) => d.parts).filter((p) => p.nestKind === "2D" && p.nestPartId !== null).map((p) => p.nestPartId));
  const target = drawings.find((d) => d.drawingNumber === NESTING_DRAWING);
  const taken = new Set((target?.parts ?? []).map((p) => `${p.description.trim().toLowerCase()}|${p.thicknessMm ?? 0}`));
  const missing = parseNestParts(ws?.data).filter(
    (r) => !linked.has(r.id) && !taken.has(`${nestPartDescription(r).toLowerCase()}|${r.th || 0}`),
  );
  if (!missing.length) return none;

  let drawingId = target?.id;
  if (!drawingId) {
    const res = await fetch("/api/takeoff/drawings", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, drawingNumber: NESTING_DRAWING, title: "Parts from 2D Nesting", weightFromDwg: null }),
    }).catch(() => null);
    if (!res?.ok) return { imported: 0, failed: missing.length };
    drawingId = ((await res.json()) as { id: string }).id;
  }

  let imported = 0;
  let failed = 0;
  for (const r of missing) {
    const form = new FormData();
    form.append("file", new File([nestPartToDxf(r)], nestPartFileName(r), { type: "application/dxf" }));
    form.append("items", JSON.stringify([{
      partIndex: 0, description: nestPartDescription(r), side: "EXTERNAL", qty: r.qty,
      thicknessMm: r.th > 0 ? r.th : null, paintSides: 2, material: r.material || "Steel", nestPartId: r.id,
    }]));
    const res = await fetch(`/api/takeoff/drawings/${drawingId}/import`, { method: "POST", body: form }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { results?: { ok: boolean }[] } | null;
    if (res?.ok && body?.results?.[0]?.ok) imported++; else failed++;
  }
  return { imported, failed };
}
