import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { advanceSchema } from "@/server/validators/production";
import { advanceStage } from "@/server/services/production.service";

// "N more pieces finished <stage>": the lowest-numbered pieces that are ready for it.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("production.update");
  if (res) return res;
  const body = await parseBody(req, advanceSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    return NextResponse.json(await advanceStage(id, body.data.stage, body.data.count, { id: session!.user.id, name: session!.user.name ?? "—" }));
  });
}
