import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requirePermission } from "@/server/api/guard";
import { documentSchema } from "@/server/validators/document";
import { createDocument, listDocuments } from "@/server/services/document.service";

export const maxDuration = 60;

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
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "File is required" }, { status: 400 });

  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === "string" && v !== "" ? v : undefined;
  };

  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const parsed = documentSchema.safeParse({
    title: field("title"),
    category: field("category"),
    projectId: field("projectId"),
    revision: field("revision"),
    folder: field("folder"),
    fileName: file.name,
    filePath: "pending", // replaced with the blob URL below, once the rest of the input is valid
    fileSize: file.size,
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const blob = await put(`documents/${safeName}`, file, { access: "public", contentType: file.type || "application/octet-stream" });
  const doc = await createDocument({ ...parsed.data, filePath: blob.url }, session!.user.id);
  return NextResponse.json(doc, { status: 201 });
}
