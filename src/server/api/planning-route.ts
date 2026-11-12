import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { PlanningError } from "@/server/services/planning.service";

/** Run a planning handler and turn PlanningError / unexpected failures into JSON responses. */
export async function planningHandler(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof PlanningError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[planning]", e);
    return NextResponse.json({ error: "Something went wrong while saving the schedule." }, { status: 500 });
  }
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T; res: null } | { data: null; res: NextResponse }> {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { data: null, res: NextResponse.json({ error: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input" }, { status: 400 }) };
  }
  return { data: parsed.data, res: null };
}
