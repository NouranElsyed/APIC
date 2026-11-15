import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { getToOrder } from "@/server/services/purchasing.service";

// The project's materials that still have a quantity left to order.
export async function GET(req: NextRequest) {
  const { res } = await requirePermission("procurement.view");
  if (res) return res;
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  return NextResponse.json(await getToOrder(projectId));
}
