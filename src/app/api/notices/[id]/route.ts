import { NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteNotice } from "@/server/services/notice.service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("documents.delete");
  if (res) return res;

  const { id } = await params;
  await deleteNotice(id, session!.user.id);
  return NextResponse.json({ ok: true });
}
