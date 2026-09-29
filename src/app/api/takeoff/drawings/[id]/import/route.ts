import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/api/guard";
import { importDxfAsPart } from "@/server/services/dxf-import.service";

const configSchema = z.object({
  description: z.string().min(1),
  partType: z.enum(["PLATE", "HOT_ROLLED"]),
  side: z.enum(["INTERNAL", "EXTERNAL"]),
  qty: z.number().int().positive(),
  thicknessMm: z.number().positive().nullable(),
  paintSides: z.union([z.literal(1), z.literal(2)]),
  material: z.string(),
  profile: z.string().optional(),
  weightPerMeter: z.number().positive().nullable().optional(),
  paintAreaPerMeter: z.number().nonnegative().nullable().optional(),
});

// POST multipart: `file` (.dxf) + `config` (JSON). One file per call.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.create");
  if (res) return res;
  const { id } = await params;

  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "File is required" }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".dxf")) return NextResponse.json({ error: "Only .dxf files are accepted" }, { status: 400 });

  let cfgRaw: unknown;
  try { cfgRaw = JSON.parse(String(form.get("config") ?? "")); } catch { cfgRaw = null; }
  const cfg = configSchema.safeParse(cfgRaw);
  if (!cfg.success) return NextResponse.json({ error: "Invalid row settings" }, { status: 400 });

  try {
    const part = await importDxfAsPart(id, file, { ...cfg.data, weightPerMeter: cfg.data.weightPerMeter ?? null }, session!.user.id);
    return NextResponse.json(part, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Import failed" }, { status: 400 });
  }
}
