import { notFound } from "next/navigation";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getQuotationDetail } from "@/server/services/quotations.service";
import { QuotationPrint } from "@/features/quotations/quotation-print";

export default async function PrintQuotationPage({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const session = await auth();
  if (!can(session?.user.role, "quotations.view")) notFound();
  const q = await getQuotationDetail(id, qid);
  if (!q) notFound();
  return <QuotationPrint q={q} />;
}
