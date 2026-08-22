import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
<<<<<<< HEAD
import { removeNestingSource } from "@/server/services/nesting.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; sourceId: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id, sourceId } = await params;
  await removeNestingSource(id, sourceId, session!.user.id);
  return NextResponse.json({ ok: true });
=======
import { nestingSourceSchema } from "@/server/validators/nesting";
import { addNestingSource } from "@/server/services/nesting.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id } = await params;
  const body = await req.json();
  const parsed = nestingSourceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const source = await addNestingSource(id, parsed.data, session!.user.id);
    return NextResponse.json(source, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to add source" }, { status: 400 });
  }
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
