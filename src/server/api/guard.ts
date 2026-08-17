import { NextResponse } from "next/server";
import { auth } from "@/server/auth/config";
import { can, type PermissionKey } from "@/server/rbac/permissions";

export async function requireSession() {
  const session = await auth();
  if (!session?.user) {
    return { session: null, res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { session, res: null };
}

export async function requirePermission(permission: PermissionKey) {
  const { session, res } = await requireSession();
  if (res) return { session: null, res };
  if (!can(session!.user.role, permission)) {
    return { session: null, res: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session, res: null };
}
