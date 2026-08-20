import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { removeNestingJobItem } from "@/server/services/nesting.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id, itemId } = await params;
  await removeNestingJobItem(id, itemId, session!.user.id);
  return NextResponse.json({ ok: true });
}
