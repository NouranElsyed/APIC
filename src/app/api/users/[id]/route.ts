import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/api/guard";
import { userUpdateSchema } from "@/server/validators/user";
import { toggleUserActive, updateUser } from "@/server/services/user.service";

type Ctx = { params: Promise<{ id: string }> };

// Full edit from the user form.
export async function PUT(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = userUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const user = await updateUser(id, parsed.data, session!.user.id);
    return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role, active: user.active });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }
    throw e;
  }
}

// Activate / deactivate from the users table.
const toggleSchema = z.object({ active: z.boolean() });

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = toggleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const user = await toggleUserActive(id, parsed.data.active, session!.user.id);
  return NextResponse.json({ id: user.id, active: user.active });
}
