import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/api/guard";
import { importDxfParts } from "@/server/services/dxf-import.service";

// A DXF is always a plate, so there is no part type here.
const itemSchema = z.object({
  partIndex: z.number().int().nonnegative(),
  description: z.string().min(1),
  side: z.enum(["INTERNAL", "EXTERNAL"]),
  qty: z.number().int().positive(),
  thicknessMm: z.number().positive().nullable(),
  paintSides: z.union([z.literal(1), z.literal(2)]),
  material: z.string(),
});

// POST multipart: `file` (.dxf) + `items` (JSON array, one entry per part to
// create from that file). One file per call.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.create");
  if (res) return res;
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "File is required" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".dxf")) return NextResponse.json({ error: "Only .dxf files are accepted" }, { status: 400 });

  let raw: unknown;
  try { raw = JSON.parse(String(form.get("items") ?? "")); } catch { raw = null; }
  const items = z.array(itemSchema).min(1).max(500).safeParse(raw);
  if (!items.success) return NextResponse.json({ error: "Invalid row settings" }, { status: 400 });

  try {
    const results = await importDxfParts(
      id, file, items.data.map((i) => ({ ...i, partType: "PLATE" as const })), session!.user.id,
    );
    return NextResponse.json({ results });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Import failed" }, { status: 400 });
  }
}
