import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requirePermission } from "@/server/api/guard";
import { documentSchema } from "@/server/validators/document";
import { createDocument, listDocuments } from "@/server/services/document.service";

export async function GET() {
  const { res } = await requirePermission("documents.view");
  if (res) return res;
  return NextResponse.json(await listDocuments());
}

// POST multipart: `file` + title, projectId, category, revision, folder (optional).
export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };

  const projectId = text("projectId") ?? "";
  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;

  // Validate the metadata first so a bad request never leaves an orphan file in storage.
  const parsed = documentSchema.safeParse({
    title: text("title") ?? file.name,
    category: text("category"),
    projectId,
    revision: text("revision"),
    folder: text("folder"),
    fileName: file.name,
    filePath: "pending",
    fileSize: file.size,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const blob = await put(`documents/${projectId}/${safeName}`, file, { access: "public", addRandomSuffix: true });
  const doc = await createDocument({ ...parsed.data, filePath: blob.url }, session!.user.id);
  return NextResponse.json(doc, { status: 201 });
}
