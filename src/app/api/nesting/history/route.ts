import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { createHistory, listHistory } from "@/server/services/nesting-history.service";

// The signed-in user's own nesting history (newest first).
export async function GET() {
  const { session, res } = await requirePermission("takeoff.view");
  if (res) return res;
  return NextResponse.json(await listHistory(session!.user.id));
}

// Starts a new history entry (what the first import made with nothing open does).
export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const entry = await createHistory(
    session!.user.id,
    typeof body?.name === "string" ? body.name : undefined,
    typeof body?.stamp === "string" ? body.stamp : undefined,
    typeof body?.hint === "string" ? body.hint : undefined,
  );
  return NextResponse.json(entry, { status: 201 });
}