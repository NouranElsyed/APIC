import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteDocument } from "@/server/services/document.service";
import { documentPatchSchema } from "@/server/validators/document";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { updateDocument } from "@/server/services/project-documents.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("documents.delete");
  if (res) return res;
  const { id } = await params;
  await deleteDocument(id, session!.user.id);
  return NextResponse.json({ ok: true });
}


export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;
  const body = await parseBody(req, documentPatchSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    await updateDocument(id, body.data, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
