import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { nestMaterialsSchema } from "@/server/validators/materials";
import { syncNestMaterials } from "@/server/services/materials.service";

// Sends the sheets a nest needs (scrap included) to the project's Materials list, ready to be ordered.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  const body = await parseBody(req, nestMaterialsSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    return NextResponse.json(await syncNestMaterials(id, body.data.lines, session!.user.id));
  });
}
