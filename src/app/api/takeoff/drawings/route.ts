import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { takeoffDrawingSchema } from "@/server/validators/takeoff";
import { listDrawingsForProject, createDrawing } from "@/server/services/takeoff.service";

export async function GET(req: NextRequest) {
  const { res } = await requirePermission("takeoff.view");
  if (res) return res;

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId query param is required" }, { status: 400 });
  }

  const drawings = await listDrawingsForProject(projectId);
  return NextResponse.json(drawings);
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("takeoff.create");
  if (res) return res;

  const body = await req.json();
  const parsed = takeoffDrawingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const drawing = await createDrawing(parsed.data, session!.user.id);
  return NextResponse.json(drawing, { status: 201 });
}
