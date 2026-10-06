import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { saveHistoryAsProject } from "@/server/services/nesting-history.service";

// Turns a history entry into a real project with the name the user typed.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("projects.create");
  if (res) return res;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (typeof body?.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "A project name is required" }, { status: 400 });
  const user = session!.user;
  const project = await saveHistoryAsProject(user.id, user.name || user.email || "User", id, body.name, typeof body?.stamp === "string" ? body.stamp : undefined);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project, { status: 201 });
}
