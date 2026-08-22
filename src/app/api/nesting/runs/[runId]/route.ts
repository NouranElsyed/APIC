import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
<<<<<<< HEAD
import { exportNestingRunDxf, exportNestingSheetDxf, NestingDxfExportError } from "@/server/services/nesting-dxf-export.service";

// GET /api/nesting/runs/:runId/dxf            -> single DXF, or a ZIP of all sheets
// GET /api/nesting/runs/:runId/dxf?sheet=2     -> just that one sheet's DXF
export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { res } = await requirePermission("nesting.view");
  if (res) return res;
  const { runId } = await params;

  const sheetParam = req.nextUrl.searchParams.get("sheet");

  try {
    if (sheetParam) {
      const sheetNumber = Number(sheetParam);
      if (!Number.isInteger(sheetNumber) || sheetNumber < 1) {
        return NextResponse.json({ error: "Invalid sheet number" }, { status: 400 });
      }
      const { fileName, content } = await exportNestingSheetDxf(runId, sheetNumber);
      return new NextResponse(content, {
        status: 200,
        headers: {
          "Content-Type": "application/dxf",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    const { fileName, content, contentType } = await exportNestingRunDxf(runId);
    return new NextResponse(new Uint8Array(content), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    if (err instanceof NestingDxfExportError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Nesting DXF export failed:", err);
    return NextResponse.json({ error: "Failed to generate DXF" }, { status: 500 });
  }
=======
import { getNestingRun, deleteNestingRun } from "@/server/services/nesting-run.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { res } = await requirePermission("nesting.view");
  if (res) return res;
  const { runId } = await params;
  const run = await getNestingRun(runId);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(run);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { session, res } = await requirePermission("nesting.delete");
  if (res) return res;
  const { runId } = await params;
  await deleteNestingRun(runId, session!.user.id);
  return NextResponse.json({ ok: true });
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
