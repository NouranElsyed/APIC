import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { meetingMinuteSchema } from "@/server/validators/meeting-minute";
import { createMeetingMinute } from "@/server/services/meeting-minute.service";

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const body = await req.json();
  const parsed = meetingMinuteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const minute = await createMeetingMinute(parsed.data, session!.user.id);
  return NextResponse.json(minute, { status: 201 });
}