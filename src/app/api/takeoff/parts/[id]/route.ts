import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { takeoffPartSchema } from "@/server/validators/takeoff";
import { updatePart, deletePart } from "@/server/services/takeoff.service";

// NOTE: this file is the Route Handler for the takeoff PART itself
// (/api/takeoff/parts/[id]) — GET/PATCH/DELETE on the part's own fields
// (description, material, thicknessMm, geometry, etc). DXF file
// upload/removal for a part lives in the sibling route
// /api/takeoff/parts/[id]/dxf/route.ts and must not be duplicated here.

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.edit");
  if (res) return res;
  const { id } = await params;

  const body = await req.json();
  const parsed = takeoffPartSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    const part = await updatePart(id, parsed.data, session!.user.id);
    return NextResponse.json(part);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to update item" }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("takeoff.delete");
  if (res) return res;
  const { id } = await params;

  try {
    await deletePart(id, session!.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to delete item";
    if (message === "NOT_FOUND") {
      return NextResponse.json({ error: "Part not found" }, { status: 404 });
    }
    // Part is referenced by a nesting placement (Restrict) — conflict, not
    // a generic bad request, so the client can distinguish "fix your input"
    // from "this can't be done right now".
    if (message.includes("cannot be deleted")) {
      return NextResponse.json({ error: message }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
