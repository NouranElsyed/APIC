import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { supplierSchema } from "@/server/validators/procurement";
import { createSupplier, listSuppliers } from "@/server/services/suppliers.service";

export async function GET() {
  const { res } = await requirePermission("procurement.view");
  if (res) return res;
  return NextResponse.json(await listSuppliers());
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("procurement.edit");
  if (res) return res;
  const body = await parseBody(req, supplierSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const s = await createSupplier(body.data, session!.user.id);
    return NextResponse.json({ id: s.id }, { status: 201 });
  });
}
