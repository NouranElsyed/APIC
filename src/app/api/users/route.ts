import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { userCreateSchema } from "@/server/validators/user";
import { listUsers, createUser } from "@/server/services/user.service";

export async function GET() {
  const { res } = await requirePermission("users.manage");
  if (res) return res;
  const users = await listUsers();
  return NextResponse.json(users);
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;

  const body = await req.json();
  const parsed = userCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await createUser(parsed.data, session!.user.id);
  return NextResponse.json(user, { status: 201 });
}