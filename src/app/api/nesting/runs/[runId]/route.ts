import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
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
}
