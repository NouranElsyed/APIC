import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { takeoffPartBulkSchema } from "@/server/validators/takeoff";
import { createPartsBulk } from "@/server/services/takeoff.service";

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.create");
  if (res) return res;

  const body = await req.json();
  const parsed = takeoffPartBulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const parts = await createPartsBulk(parsed.data.drawingId, parsed.data.rows, session!.user.id);
  return NextResponse.json(parts, { status: 201 });
}
