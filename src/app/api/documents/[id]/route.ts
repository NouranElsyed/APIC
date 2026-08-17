import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteDocument } from "@/server/services/document.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("documents.delete");
  if (res) return res;
  const { id } = await params;
  await deleteDocument(id, session!.user.id);
  return NextResponse.json({ ok: true });
}
