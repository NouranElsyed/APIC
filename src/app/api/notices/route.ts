<<<<<<< HEAD
import { NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteNotice } from "@/server/services/notice.service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("documents.delete");
  if (res) return res;

  const { id } = await params;
  await deleteNotice(id, session!.user.id);
  return NextResponse.json({ ok: true });
=======
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { noticeSchema } from "@/server/validators/notice";
import { createNotice } from "@/server/services/notice.service";

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const body = await req.json();
  const parsed = noticeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const notice = await createNotice(parsed.data, session!.user.id);
  return NextResponse.json(notice, { status: 201 });
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
