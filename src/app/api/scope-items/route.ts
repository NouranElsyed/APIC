import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { scopeItemSchema } from "@/server/validators/scope-item";
import { createScopeItem } from "@/server/services/scope-item.service";

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const body = await req.json();
  const parsed = scopeItemSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const item = await createScopeItem(parsed.data, session!.user.id);
  return NextResponse.json(item, { status: 201 });
}
