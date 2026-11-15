import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getPiece } from "@/server/services/production.service";
import { ScanView } from "@/features/production/scan-view";

// Opened by scanning a piece's QR label with a phone.
export default async function ScanPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await auth();
  if (!can(session?.user.role, "production.view")) notFound();
  const piece = await getPiece(decodeURIComponent(code));
  if (!piece) notFound();
  return <ScanView initial={piece} canUpdate={can(session?.user.role, "production.update")} />;
}
