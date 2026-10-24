import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { projectSchema } from "@/server/validators/project";
import { getProject, updateProject, deleteProject, renameProject } from "@/server/services/project.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { res } = await requirePermission("projects.view");
  if (res) return res;
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("projects.edit");
  if (res) return res;
  const { id } = await params;

  const body = await req.json();
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await updateProject(id, parsed.data, session!.user.id);
  return NextResponse.json(project);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("projects.delete");
  if (res) return res;
  const { id } = await params;
  await deleteProject(id, session!.user.id);
  return NextResponse.json({ ok: true });
}

// Quick rename (used by the Takeoff / Nesting project bar) — everything else is left untouched.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("projects.edit");
  if (res) return res;
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "A name is required" }, { status: 400 });
  const project = await renameProject(id, name, session!.user.id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}
