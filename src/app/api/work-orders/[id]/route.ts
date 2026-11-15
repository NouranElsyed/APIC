import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { planningHandler } from "@/server/api/planning-route";
import { deleteWorkOrder } from "@/server/services/production.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("production.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    await deleteWorkOrder(id, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
