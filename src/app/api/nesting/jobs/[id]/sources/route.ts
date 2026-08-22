import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { nestingSourceSchema } from "@/server/validators/nesting";
import { addNestingSource } from "@/server/services/nesting.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id } = await params;

  const body = await req.json();
  const parsed = nestingSourceSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const source = await addNestingSource(id, parsed.data, session!.user.id);
  return NextResponse.json(source, { status: 201 });
}