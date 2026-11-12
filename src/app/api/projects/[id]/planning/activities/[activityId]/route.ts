import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { activitySchema } from "@/server/validators/planning";
import { deleteActivity, updateActivity } from "@/server/services/planning.service";

type Ctx = { params: Promise<{ id: string; activityId: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, activitySchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id, activityId } = await params;
    await updateActivity(id, activityId, body.data, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id, activityId } = await params;
    await deleteActivity(id, activityId, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
