import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { userUpdateSchema } from "@/server/validators/user";
import { updateUser, toggleUserActive } from "@/server/services/user.service";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;

  const body = await req.json();
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
}
