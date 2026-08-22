import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
<<<<<<< HEAD
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
=======
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

  try {
    const user = await createUser(parsed.data, session!.user.id);
    return NextResponse.json(user, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
  }
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
