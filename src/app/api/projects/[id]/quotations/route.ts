import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { quotationSchema } from "@/server/validators/quotations";
import { createQuotation, getQuotationsData } from "@/server/services/quotations.service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("quotations.view");
  if (res) return res;
  return planningHandler(async () => NextResponse.json(await getQuotationsData((await params).id)));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("quotations.edit");
  if (res) return res;
  const body = await parseBody(req, quotationSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    const q = await createQuotation(id, body.data, { id: session!.user.id, name: session!.user.name ?? "—" });
    return NextResponse.json({ id: q.id, number: q.number }, { status: 201 });
  });
}
