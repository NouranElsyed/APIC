import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { pieceActionSchema } from "@/server/validators/production";
import { getPiece, updatePiece } from "@/server/services/production.service";

type Ctx = { params: Promise<{ code: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("production.view");
  if (res) return res;
  const { code } = await params;
  const piece = await getPiece(decodeURIComponent(code));
  return piece ? NextResponse.json(piece) : NextResponse.json({ error: "Piece not found" }, { status: 404 });
}

// Finish (or undo) one stage on a single piece — what the QR scan page calls.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("production.update");
  if (res) return res;
  const body = await parseBody(req, pieceActionSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { code } = await params;
    return NextResponse.json(await updatePiece(decodeURIComponent(code), body.data.stage, body.data.action, { id: session!.user.id, name: session!.user.name ?? "—" }));
  });
}
