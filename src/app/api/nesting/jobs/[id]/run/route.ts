import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { nestingRunConfigSchema } from "@/server/validators/nesting";
import { runNestingForJob, getPartGeometryForRun, NestingRunError } from "@/server/services/nesting-run.service";
import { DEFAULT_ENGINE_CONFIG } from "@/server/calc/nesting-engine";

// POST /api/nesting/jobs/:id/run — the real "Run Nesting" endpoint
// (PROJECT.md §15). Follows this project's existing nesting route
// convention (/api/nesting/jobs/[id]/...) rather than the
// /api/projects/:projectId/nesting/jobs/:jobId/run shape suggested in the
// task doc, since the job id alone already resolves the project via
// NestingJob.projectId — see nesting.service.ts.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id } = await params;

  let overrides: {
    partGapMm?: number;
    marginLeftMm?: number;
    marginRightMm?: number;
    marginTopMm?: number;
    marginBottomMm?: number;
  } = {};
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = nestingRunConfigSchema.safeParse(body ?? {});
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    overrides = parsed.data;
  } catch {
    // No body / invalid JSON — run with defaults.
  }

  const config = {
    partGapMm: overrides.partGapMm ?? DEFAULT_ENGINE_CONFIG.partGapMm,
    marginLeftMm: overrides.marginLeftMm ?? DEFAULT_ENGINE_CONFIG.marginLeftMm,
    marginRightMm: overrides.marginRightMm ?? DEFAULT_ENGINE_CONFIG.marginRightMm,
    marginTopMm: overrides.marginTopMm ?? DEFAULT_ENGINE_CONFIG.marginTopMm,
    marginBottomMm: overrides.marginBottomMm ?? DEFAULT_ENGINE_CONFIG.marginBottomMm,
  };

  try {
    const { run } = await runNestingForJob(id, session!.user.id, config);
    if (!run) {
      return NextResponse.json({ error: "Nesting run failed to persist" }, { status: 500 });
    }
    const partGeometryById = await getPartGeometryForRun(run);
    return NextResponse.json({ ...run, partGeometryById }, { status: 201 });
  } catch (err) {
    if (err instanceof NestingRunError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Nesting run failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Nesting run failed" },
      { status: 500 },
    );
  }
}
