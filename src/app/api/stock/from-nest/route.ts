import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { stockFromNestSchema } from "@/server/validators/procurement";
import { registerRemnants } from "@/server/services/stock.service";

// Registers the remnants found on a nest's sheets in the stock.
export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("stock.edit");
  if (res) return res;
  const body = await parseBody(req, stockFromNestSchema);
  if (body.res) return body.res;
  return planningHandler(async () => NextResponse.json(await registerRemnants(body.data, { id: session!.user.id, name: session!.user.name ?? "—" }), { status: 201 }));
}
