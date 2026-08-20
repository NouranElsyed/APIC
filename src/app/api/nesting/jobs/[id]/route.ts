import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { nestingJobItemSchema } from "@/server/validators/nesting";
import { addNestingJobItem } from "@/server/services/nesting.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("nesting.edit");
  if (res) return res;
  const { id } = await params;
  const body = await req.json();
  const parsed = nestingJobItemSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    const item = await addNestingJobItem(id, parsed.data, session!.user.id);
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to add item" }, { status: 400 });
  }
}
