import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { scrapPricingInputsSchema } from "@/server/validators/nesting";
import { calculateScrapPricingForRun, ScrapPricingError } from "@/server/services/scrap-pricing.service";

// POST rather than GET because the payload includes an optional per-group
// overrides map, which doesn't fit cleanly in query params.
export async function POST(req: NextRequest) {
  const { res } = await requirePermission("scrapPricing.view");
  if (res) return res;

  const body = await req.json().catch(() => null);
  const parsed = scrapPricingInputsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { nestingRunId, overridesByGroupKey, ...globals } = parsed.data;

  try {
    const result = await calculateScrapPricingForRun(nestingRunId, globals, overridesByGroupKey ?? {});
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ScrapPricingError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
