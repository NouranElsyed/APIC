import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { quotationPatchSchema } from "@/server/validators/quotations";
import { deleteQuotation, updateQuotation } from "@/server/services/quotations.service";

type Ctx = { params: Promise<{ id: string; qid: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("quotations.edit");
  if (res) return res;
  const body = await parseBody(req, quotationPatchSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id, qid } = await params;
    await updateQuotation(id, qid, body.data, { id: session!.user.id, name: session!.user.name ?? "—" });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("quotations.delete");
  if (res) return res;
  return planningHandler(async () => {
    const { id, qid } = await params;
    await deleteQuotation(id, qid, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
