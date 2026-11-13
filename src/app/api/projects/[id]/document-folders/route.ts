import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/api/guard";
import { parseBody, planningHandler } from "@/server/api/planning-route";
import { createFolder, deleteFolder } from "@/server/services/project-documents.service";

const schema = z.object({ path: z.string().min(1).max(130) });
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;
  const body = await parseBody(req, schema);
  if (body.res) return body.res;
  return planningHandler(async () => NextResponse.json({ path: await createFolder((await params).id, body.data.path, session!.user.id) }, { status: 201 }));
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { session, res } = await requirePermission("documents.delete");
  if (res) return res;
  const path = req.nextUrl.searchParams.get("path");
  if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });
  return planningHandler(async () => {
    await deleteFolder((await params).id, path, session!.user.id);
    return NextResponse.json({ ok: true });
  });
}
