import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { customerSchema } from "@/server/validators/customer";
import { listCustomers, createCustomer } from "@/server/services/customer.service";

export async function GET() {
  const { res } = await requirePermission("customers.view");
  if (res) return res;
  const customers = await listCustomers();
  return NextResponse.json(customers);
}

export async function POST(req: NextRequest) {
  const { session, res } = await requirePermission("customers.create");
  if (res) return res;

  const body = await req.json();
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const customer = await createCustomer(parsed.data, session!.user.id);
  return NextResponse.json(customer, { status: 201 });
}
