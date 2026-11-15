import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { can } from "@/server/rbac/permissions";
import { convertExecutionSchema } from "@/server/validators/project";
import { convertToExecution, getExecutionPreflight } from "@/server/services/execution.service";

type Ctx = { params: Promise<{ id: string }> };

// What converting this project to execution would do, and what stands in the way.
export async function GET(_req: NextRequest, { params }: Ctx) {
  const { res } = await requirePermission("projects.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    const pre = await getExecutionPreflight(id);
    if (!pre) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json(pre);
  });
}

// Converts the project: budget frozen, first schedule + baseline, material requests, stage switched.
export async function POST(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("projects.edit");
  if (res) return res;
  // the conversion also creates a schedule and materials, so it needs those permissions too
  if (!can(session!.user.role, "planning.edit")) return NextResponse.json({ error: "You need permission to edit planning to convert a project" }, { status: 403 });

  const body = await parseBody(req, convertExecutionSchema);
  if (body.res) return body.res;
  return planningHandler(async () => {
    const { id } = await params;
    return NextResponse.json(await convertToExecution(id, body.data, session!.user.id));
  });
}
