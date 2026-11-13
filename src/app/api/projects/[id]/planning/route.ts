import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { activitySchema } from "@/server/validators/planning";
import { createActivity } from "@/server/services/planning.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, activitySchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    await createActivity(id, body.data, session!.user.id);
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
