import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { baselineSchema } from "@/server/validators/planning";
import { setBaseline } from "@/server/services/planning.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, baselineSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    await setBaseline(id, body.data.name, session!.user.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
