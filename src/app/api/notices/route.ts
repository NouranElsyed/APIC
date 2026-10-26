import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { noticeSchema } from "@/server/validators/notice";
import { createNotice } from "@/server/services/notice.service";

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const body = await req.json();
  const parsed = noticeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const notice = await createNotice(parsed.data, session!.user.id);
  return NextResponse.json(notice, { status: 201 });
}