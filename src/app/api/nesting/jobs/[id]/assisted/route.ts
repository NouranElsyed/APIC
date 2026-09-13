import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import {
  saveAssistedNestingRun,
  getPartGeometryForRun,
  NestingRunError,
  AssistedSessionValidationError,
} from "@/server/services/nesting-run.service";
import { DEFAULT_ENGINE_CONFIG } from "@/server/calc/nesting-engine";
import { assistedNestingSaveSchema } from "@/server/validators/nesting";
import type { AssistedSheetSession, SessionPartCatalogEntry } from "@/server/calc/nesting-assisted-session";

// POST /api/nesting/jobs/:id/assisted — Phase 2C: persists an
// assisted-nesting session (AssistedNestingCanvas's in-memory sheets) as a
// real NestingRun via saveAssistedNestingRun(), reusing the exact same
// NestingRun/NestingSheet/NestingPlacement models and REST shape as the
// automatic /run endpoint above — after saving, GET
// /api/nesting/runs/[runId] and the existing DXF export route both work
// on the result completely unchanged.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = assistedNestingSaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const partCatalog = new Map<string, SessionPartCatalogEntry>(
    parsed.data.parts.map((p) => [p.takeoffPartId, p]),
  );
  const sheets: AssistedSheetSession[] = parsed.data.sheets.map((sheet) => ({
    ...sheet,
    instances: sheet.instances.map((inst) => ({
      ...inst,
      outer: partCatalog.get(inst.takeoffPartId)?.outer ?? [],
      areaSqm: partCatalog.get(inst.takeoffPartId)?.areaSqm ?? 0,
    })),
  }));

  const config = {
    partGapMm: parsed.data.config?.partGapMm ?? DEFAULT_ENGINE_CONFIG.partGapMm,
    marginLeftMm: parsed.data.config?.marginLeftMm ?? DEFAULT_ENGINE_CONFIG.marginLeftMm,
    marginRightMm: parsed.data.config?.marginRightMm ?? DEFAULT_ENGINE_CONFIG.marginRightMm,
    marginTopMm: parsed.data.config?.marginTopMm ?? DEFAULT_ENGINE_CONFIG.marginTopMm,
    marginBottomMm: parsed.data.config?.marginBottomMm ?? DEFAULT_ENGINE_CONFIG.marginBottomMm,
  };

  try {
    const run = await saveAssistedNestingRun({ jobId: id, userId: session!.user.id, sheets, partCatalog, config });
    if (!run) {
      return NextResponse.json({ error: "Assisted nesting run failed to persist" }, { status: 500 });
    }
    const partGeometryById = await getPartGeometryForRun(run);
    return NextResponse.json({ ...run, partGeometryById }, { status: 201 });
  } catch (err) {
    if (err instanceof AssistedSessionValidationError) {
      return NextResponse.json({ error: err.message, issues: err.issues }, { status: 400 });
    }
    if (err instanceof NestingRunError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Assisted nesting save failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Assisted nesting save failed" },
      { status: 500 },
    );
  }
}
