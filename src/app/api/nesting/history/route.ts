import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { createHistory, listHistory } from "@/server/services/nesting-history.service";

// Per-user nesting history: each signed-in user only ever sees their own entries.
export async function GET() {
  const { session, res } = await requirePermission("takeoff.view");
  if (res) return res;
  return NextResponse.json(await listHistory(session!.user.id));
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const entry = await createHistory(session!.user.id, str(body?.name), str(body?.stamp), str(body?.hint));
  return NextResponse.json(entry, { status: 201 });
}
