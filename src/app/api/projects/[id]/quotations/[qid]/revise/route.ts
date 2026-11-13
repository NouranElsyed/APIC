import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { planningHandler } from "@/server/api/planning-route";
import { reviseQuotation } from "@/server/services/quotations.service";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  const { session, res } = await requirePermission("quotations.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id, qid } = await params;
    const q = await reviseQuotation(id, qid, { id: session!.user.id, name: session!.user.name ?? "—" });
    return NextResponse.json({ id: q.id, revision: q.revision }, { status: 201 });
  });
}
