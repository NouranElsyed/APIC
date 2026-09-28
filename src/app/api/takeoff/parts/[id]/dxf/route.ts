import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { prisma } from "@/server/db/client";
import { saveAndParseDxf, deleteDxf } from "@/server/services/dxf.service";

// Streams the stored DXF text back through our own origin so the DXF Nesting
// tab can import it without depending on the blob host's CORS settings.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { res } = await requirePermission("takeoff.view");
  if (res) return res;
  const { id } = await params;
  const dxf = await prisma.partDxf.findUnique({ where: { takeoffPartId: id } });
  if (!dxf) return NextResponse.json({ error: "No DXF for this part" }, { status: 404 });
  const upstream = await fetch(dxf.filePath);
  if (!upstream.ok) return NextResponse.json({ error: "Could not read the stored DXF file" }, { status: 502 });
  return new NextResponse(await upstream.text(), {
    headers: { "Content-Type": "application/dxf; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "File is required" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".dxf")) {
    return NextResponse.json({ error: "Only .dxf files are accepted" }, { status: 400 });
  }

  try {
    const dxf = await saveAndParseDxf(id, file, session!.user.id);
    return NextResponse.json(dxf, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to process DXF" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;
  await deleteDxf(id, session!.user.id);
  return NextResponse.json({ ok: true });
}
