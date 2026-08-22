import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { projectSchema } from "@/server/validators/project";
import { getProject, updateProject, deleteProject } from "@/server/services/project.service";

<<<<<<< HEAD
// src/app/api/projects/[id]/route.ts — keep this one using params.id
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
=======
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
  const { res } = await requirePermission("projects.view");
  if (res) return res;
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(project);
}
<<<<<<< HEAD
=======

>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
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
