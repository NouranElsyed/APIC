import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { partGroupSchema } from "@/server/validators/part-group";
import { createGroup, getBoq, PartGroupError } from "@/server/services/part-group.service";

const fail = (e: unknown) => {
  if (e instanceof PartGroupError) return NextResponse.json({ error: e.message }, { status: e.status });
  console.error("[part-groups]", e);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
};

// GET /api/part-groups?projectId=... — assemblies with weights (fabricated / accessories / total).
export async function GET(req: NextRequest) {
  const { res } = await requirePermission("takeoff.view");
  if (res) return res;
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  try {
    return NextResponse.json(await getBoq(projectId));
  } catch (e) { return fail(e); }
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.create");
  if (res) return res;
  const parsed = partGroupSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  try {
    return NextResponse.json(await createGroup(parsed.data, session!.user.id), { status: 201 });
  } catch (e) { return fail(e); }
}
