import { NextRequest, NextResponse } from "next/server";
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

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("documents.create");
  if (res) return res;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "File is required" }, { status: 400 });

  const parsed = documentSchema.safeParse({
    title: form.get("title"),
    category: form.get("category") || undefined,
    projectId: form.get("projectId"),
    revision: form.get("revision") || undefined,
    fileName: file.name,
    filePath: "",
    fileSize: file.size,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const blob = await put(`documents/${safeName}`, bytes, {
    access: "public",
    contentType: file.type || "application/octet-stream",
  });

  const document = await createDocument({ ...parsed.data, filePath: blob.url }, session!.user.id);
  return NextResponse.json(document, { status: 201 });
}