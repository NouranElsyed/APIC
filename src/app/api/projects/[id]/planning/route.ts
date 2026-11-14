import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { createScheduleSchema, updateScheduleSchema } from "@/server/validators/planning";
import { createSchedule, deleteSchedule, updateSchedule } from "@/server/services/planning.service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, createScheduleSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    const s = await createSchedule(id, body.data, session!.user.id);
    return NextResponse.json({ id: s.id }, { status: 201 });
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, updateScheduleSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    await updateSchedule(id, body.data, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("planning.delete");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    await deleteSchedule(id, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
