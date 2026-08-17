import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { takeoffPartSchema } from "@/server/validators/takeoff";
import { createPart } from "@/server/services/takeoff.service";

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.create");
  if (res) return res;

  const body = await req.json();
  const parsed = takeoffPartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const part = await createPart(parsed.data, session!.user.id);
  return NextResponse.json(part, { status: 201 });
}
