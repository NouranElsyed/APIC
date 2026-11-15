import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { supplierSchema } from "@/server/validators/procurement";
import { deleteSupplier, updateSupplier } from "@/server/services/suppliers.service";

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("procurement.edit");
  if (res) return res;
  const body = await parseBody(req, supplierSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    await updateSupplier(id, body.data, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("procurement.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    await deleteSupplier(id, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
