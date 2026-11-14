import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { assignHistoryToProject } from "@/server/services/nesting-history.service";

// Links a standalone nest (history entry) to an existing project: its nesting data is copied into that project.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.projectId !== "string" || !body.projectId) return NextResponse.json({ error: "A project is required" }, { status: 400 });
  const project = await assignHistoryToProject(session!.user.id, id, body.projectId);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}
