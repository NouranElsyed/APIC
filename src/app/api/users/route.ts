import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { resetUserPassword } from "@/server/services/user.service";
import { z } from "zod";

const schema = z.object({ password: z.string().min(6) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await resetUserPassword(id, parsed.data.password, session!.user.id);
  return NextResponse.json({ ok: true });
}
