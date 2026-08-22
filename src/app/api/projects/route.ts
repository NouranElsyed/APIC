<<<<<<< HEAD
// src/app/api/projects/route.ts
=======
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { projectSchema } from "@/server/validators/project";
import { listProjects, createProject } from "@/server/services/project.service";

export async function GET() {
  const { session, res } = await requirePermission("projects.view");
  if (res) return res;
  const projects = await listProjects();
  return NextResponse.json(projects);
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("projects.create");
  if (res) return res;

  const body = await req.json();
  const parsed = projectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const project = await createProject(parsed.data, session!.user.id);
  return NextResponse.json(project, { status: 201 });
<<<<<<< HEAD
}
=======
}
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
