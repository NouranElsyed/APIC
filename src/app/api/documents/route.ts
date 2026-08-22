import { NextRequest, NextResponse } from "next/server";
<<<<<<< HEAD
import { requirePermission } from "@/server/api/guard";
import { deleteDocument } from "@/server/services/document.service";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("documents.delete");
  if (res) return res;
  const { id } = await params;
  await deleteDocument(id, session!.user.id);
  return NextResponse.json({ ok: true });
=======
import { put } from "@vercel/blob";
import { requirePermission } from "@/server/api/guard";
import { documentSchema } from "@/server/validators/document";
import { listDocuments, createDocument } from "@/server/services/document.service";

export async function GET() {
  const { res } = await requirePermission("documents.view");
  if (res) return res;
  const documents = await listDocuments();
  return NextResponse.json(documents);
}

// Accepts multipart/form-data: file + title + category + projectId + revision
// Files are stored in Vercel Blob (persistent, public URL). Vercel's
// serverless functions run from a read-only bundle — only /tmp is
// writable, and it doesn't persist between invocations — so writing to
// public/uploads works locally but throws ENOENT/EROFS in production.
export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const title = form.get("title") as string;
  const category = form.get("category") as string;
  const projectId = form.get("projectId") as string;
  const revision = (form.get("revision") as string) || "Rev. 00";

  if (!file) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const blob = await put(`documents/${safeName}`, bytes, { access: "public" });

  const parsed = documentSchema.safeParse({
    title,
    category,
    projectId,
    revision,
    fileName: file.name,
    filePath: blob.url,
    fileSize: file.size,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const doc = await createDocument(parsed.data, session!.user.id);
  return NextResponse.json(doc, { status: 201 });
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
