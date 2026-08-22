import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
<<<<<<< HEAD
import { resetUserPassword } from "@/server/services/user.service";
import { z } from "zod";

const schema = z.object({ password: z.string().min(6) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
=======
import { userUpdateSchema } from "@/server/validators/user";
import { updateUser, toggleUserActive } from "@/server/services/user.service";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;

  const body = await req.json();
<<<<<<< HEAD
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await resetUserPassword(id, parsed.data.password, session!.user.id);
  return NextResponse.json({ ok: true });
=======
  const parsed = userUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await updateUser(id, parsed.data, session!.user.id);
  return NextResponse.json(user);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;
  const { active } = await req.json();
  const user = await toggleUserActive(id, active, session!.user.id);
  return NextResponse.json(user);
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
