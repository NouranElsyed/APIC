<<<<<<< HEAD
import { NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { deleteMeetingMinute } from "@/server/services/meeting-minute.service";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("documents.delete");
  if (res) return res;

  const { id } = await params;
  await deleteMeetingMinute(id, session!.user.id);
  return NextResponse.json({ ok: true });
=======
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { meetingMinuteSchema } from "@/server/validators/meeting-minute";
import { createMeetingMinute } from "@/server/services/meeting-minute.service";

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const body = await req.json();
  const parsed = meetingMinuteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const meeting = await createMeetingMinute(parsed.data, session!.user.id);
  return NextResponse.json(meeting, { status: 201 });
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
