import { NextRequest, NextResponse } from "next/server";
import { requireSession, requirePermission } from "@/server/api/guard";
import { companySettingsSchema } from "@/server/validators/settings";
import { getSettings, updateSettings } from "@/server/services/settings.service";

export async function GET() {
  const { res } = await requireSession();
  if (res) return res;
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const { session, res } = await requirePermission("settings.manage");
  if (res) return res;

  const body = await req.json();
  const parsed = companySettingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const settings = await updateSettings(parsed.data, session!.user.id);
  return NextResponse.json(settings);
}
