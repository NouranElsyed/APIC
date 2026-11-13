import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { planningHandler } from "@/server/api/planning-route";
import { importXer, PlanningError } from "@/server/services/planning.service";
import { isXer } from "@/features/planning/xer";

export const maxDuration = 60;
const MAX_BYTES = 25 * 1024 * 1024;

/** XER files are usually Windows-1252; fall back to it when UTF-8 decoding produces replacement characters. */
function decode(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  return utf8.includes("\uFFFD") ? new TextDecoder("windows-1252").decode(buf) : utf8;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("planning.edit");
  if (res) return res;
  return planningHandler(async () => {
    const { id } = await params;
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new PlanningError("Choose an .xer file to import.");
    if (file.size > MAX_BYTES) throw new PlanningError("The file is larger than 25 MB.");
    const text = decode(await file.arrayBuffer());
    if (!isXer(text)) throw new PlanningError("This does not look like a Primavera XER file (it should start with ERMHDR).");
    const pid = form?.get("p6ProjectId");
    const flag = (k: string) => form?.get(k) === "1";
    const report = await importXer(
      id, text,
      {
        projectId: typeof pid === "string" && pid ? pid : undefined,
        mode: form?.get("mode") === "replace" ? "replace" : "update",
        keepProgress: flag("keepProgress"), removeMissing: flag("removeMissing"), dryRun: flag("dryRun"),
      },
      session!.user.id,
    );
    return NextResponse.json(report);
  });
}
