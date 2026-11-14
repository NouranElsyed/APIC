import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/api/guard";
import { userUpdateSchema } from "@/server/validators/user";
import { toggleUserActive, updateUser } from "@/server/services/user.service";

type Ctx = { params: Promise<{ id: string }> };

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "P2002";
}

// Full edit from the user form.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;

  const body = await req.json();
  const parsed = userUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const user = await updateUser(id, parsed.data, session!.user.id);
    return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active });
  } catch (err) {
    if (isUniqueViolation(err)) return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    throw err;
  }
}

// Activate / deactivate toggle from the users table.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = z.object({ active: z.boolean() }).safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await toggleUserActive(id, parsed.data.active, session!.user.id);
  return NextResponse.json({ id: user.id, active: user.active });
}
