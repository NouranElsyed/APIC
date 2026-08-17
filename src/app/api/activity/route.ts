import { NextResponse } from "next/server";
import { requireSession } from "@/server/api/guard";
import { getRecentActivity } from "@/server/services/activity-log.service";

export async function GET() {
  const { res } = await requireSession();
  if (res) return res;
  const activity = await getRecentActivity(8);
  return NextResponse.json(activity);
}
