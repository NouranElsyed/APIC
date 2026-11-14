import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteNestingJob, getNestingJob } from "@/server/services/nesting.service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("nesting.view");
  if (res) return res;
  const { id } = await params;
  const job = await getNestingJob(id);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(job);
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("nesting.delete");
  if (res) return res;
  const { id } = await params;
  await deleteNestingJob(id, session!.user.id);
  return NextResponse.json({ ok: true });
}
