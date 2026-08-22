import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/server/api/guard";
import { customerSchema } from "@/server/validators/customer";
<<<<<<< HEAD
import { getCustomer, updateCustomer, deleteCustomer } from "@/server/services/customer.service";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { res } = await requirePermission("customers.view");
  if (res) return res;
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(customer);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("customers.edit");
  if (res) return res;
  const { id } = await params;
=======
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
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844

  const body = await req.json();
  const parsed = customerSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

<<<<<<< HEAD
  const customer = await updateCustomer(id, parsed.data, session!.user.id);
  return NextResponse.json(customer);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { session, res } = await requirePermission("customers.delete");
  if (res) return res;
  const { id } = await params;
  await deleteCustomer(id, session!.user.id);
  return NextResponse.json({ ok: true });
=======
  const customer = await createCustomer(parsed.data, session!.user.id);
  return NextResponse.json(customer, { status: 201 });
>>>>>>> 2c19167ddb7b87b5399d7f7ef7f968690531f844
}
