import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { createWorkOrdersSchema, productionLinkSchema } from "@/server/validators/production";
import { createWorkOrders, getProduction, setProductionWbs } from "@/server/services/production.service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("production.view");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    const data = await getProduction(id);
    return data ? NextResponse.json(data) : NextResponse.json({ error: "Project not found" }, { status: 404 });
  });
}

// Releases takeoff parts to the shop: one work order per part.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("production.edit");
  if (res) return res;
  const body = await parseBody(req, createWorkOrdersSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    return NextResponse.json(await createWorkOrders(id, body.data, { id: session!.user.id, name: session!.user.name ?? "—" }), { status: 201 });
  });
}

// Links (or unlinks) the schedule WBS whose activities follow the production percentage.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("production.edit");
  if (res) return res;
  const body = await parseBody(req, productionLinkSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    return NextResponse.json({ sync: await setProductionWbs(id, body.data.wbsId, session!.user.id) });
  });
}
