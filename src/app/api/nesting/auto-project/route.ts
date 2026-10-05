import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { createAutoNestingProject } from "@/server/services/nesting-workspace.service";

// Creates "<user> — <date>" project for a DXF / CSV import made with no project selected.
export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("projects.create");
  if (res) return res;
  const body = await req.json().catch(() => ({}));
  const stamp = typeof body?.stamp === "string" ? body.stamp : undefined;
  const user = session!.user;
  const project = await createAutoNestingProject(user.id, user.name || user.email || "User", stamp);
  return NextResponse.json(project, { status: 201 });
}
