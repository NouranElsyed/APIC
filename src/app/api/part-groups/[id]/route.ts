import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { partGroupSchema } from "@/server/validators/part-group";
import { deleteGroup, PartGroupError, updateGroup } from "@/server/services/part-group.service";

type Ctx = { params: Promise<{ id: string }> };

const fail = (e: unknown) => {
  if (e instanceof PartGroupError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[part-groups]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
};

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  const parsed = partGroupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json(await updateGroup(id, parsed.data, session!.user.id));
  } catch (e) { return fail(e); }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("takeoff.delete");
  if (res) return res;
  const { id } = await params;
  try {
    await deleteGroup(id, session!.user.id);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
