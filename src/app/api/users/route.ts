import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { userCreateSchema } from "@/server/validators/user";
import { createUser, listUsers } from "@/server/services/user.service";

export async function GET() {
  const { res } = await requirePermission("users.manage");
  if (res) return res;
  return NextResponse.json(await listUsers());
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("users.manage");
  if (res) return res;

  const body = await req.json();
  const parsed = userCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const user = await createUser(parsed.data, session!.user.id);
    return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role }, { status: 201 });
  } catch (err) {
    // Unique constraint on email
    if (typeof err === "object" && err && "code" in err && (err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A user with this email already exists" }, { status: 409 });
    }
    throw err;
  }
}
