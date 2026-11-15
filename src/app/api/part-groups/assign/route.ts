import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { assignPartsSchema } from "@/server/validators/part-group";
import { assignParts, PartGroupError } from "@/server/services/part-group.service";

// POST { projectId, groupId | null, partIds[], qtyPerAssembly? } — move parts into an assembly (or out of it).
export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const parsed = assignPartsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json(await assignParts(parsed.data, session!.user.id));
  } catch (e) {
    if (e instanceof PartGroupError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[part-groups/assign]", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
