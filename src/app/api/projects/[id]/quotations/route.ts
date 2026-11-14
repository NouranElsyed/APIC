import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { quotationSchema } from "@/server/validators/quotations";
import { createQuotation } from "@/server/services/quotations.service";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("quotations.edit");
  if (res) return res;
  const body = await parseBody(req, quotationSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    const q = await createQuotation(id, body.data, { id: session!.user.id, name: session!.user.name ?? "—" });
    return NextResponse.json({ id: q.id }, { status: 201 });
  });
}
