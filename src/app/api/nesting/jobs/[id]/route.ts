import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { removeNestingSource } from "@/server/services/nesting.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id, sourceId } = await params;
  await removeNestingSource(id, sourceId, session!.user.id);
  return NextResponse.json({ ok: true });
}
