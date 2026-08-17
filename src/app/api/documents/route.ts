import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
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
// Files are written to /public/uploads (local disk storage for development,
// per Phase 1 spec — a cloud storage provider can replace this later without
// changing the Document model or API contract).
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

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const safeName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(uploadsDir, safeName), bytes);

  const parsed = documentSchema.safeParse({
    title,
    category,
    projectId,
    revision,
    fileName: file.name,
    filePath: `/uploads/${safeName}`,
    fileSize: file.size,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const doc = await createDocument(parsed.data, session!.user.id);
  return NextResponse.json(doc, { status: 201 });
}
