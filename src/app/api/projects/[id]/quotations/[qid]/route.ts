import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { statusSchema } from "@/server/validators/quotations";
import { needsApprover } from "@/features/quotations/quotation";
import { can } from "@/server/rbac/permissions";
import { setQuotationStatus } from "@/server/services/quotations.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; qid: string }> }) {
  const { session, res } = await requirePermission("quotations.edit");
  if (res) return res;
  const body = await parseBody(req, statusSchema);
  if (body.res) return body.res;
  // Approving or rejecting is a separate, stricter permission.
  if (needsApprover(body.data.status) && !can(session!.user.role, "quotations.approve")) {
    return NextResponse.json({ error: "Only an admin can approve or reject a quotation." }, { status: 403 });
  }
  return planningHandler(async () => {
    const { id, qid } = await params;
    await setQuotationStatus(id, qid, body.data.status, { id: session!.user.id, name: session!.user.name ?? "—" }, body.data.note);
    return NextResponse.json({ ok: true });
  });
}
