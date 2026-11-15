import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { listPieceCodes } from "@/server/services/production.service";
import { LabelSheet } from "@/features/production/label-sheet";

export default async function WorkOrderLabelsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!can(session?.user.role, "production.view")) notFound();
  const data = await listPieceCodes(id);
  if (!data) notFound();
  return <LabelSheet data={data} />;
}
