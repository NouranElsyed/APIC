import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { nestingJobSchema } from "@/server/validators/nesting";
import { listNestingJobs, createNestingJob } from "@/server/services/nesting.service";

export async function GET(req: NextRequest) {
  const { res } = await requirePermission("nesting.view");
  if (res) return res;
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  const jobs = await listNestingJobs(projectId);
  return NextResponse.json(jobs);
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("nesting.create");
  if (res) return res;
  const body = await req.json();
  const parsed = nestingJobSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const job = await createNestingJob(parsed.data, session!.user.id);
  return NextResponse.json(job, { status: 201 });
}
