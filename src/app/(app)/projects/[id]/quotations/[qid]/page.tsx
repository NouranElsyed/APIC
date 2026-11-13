import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { auth } from "@/server/auth/config";
import { can } from "@/server/rbac/permissions";
import { getQuotationDetail } from "@/server/services/quotations.service";
import { QuotationDetail } from "@/features/quotations/quotation-detail";

export default async function QuotationPage({ params }: { params: Promise<{ id: string; qid: string }> }) {
  const { id, qid } = await params;
  const session = await auth();
  const role = session?.user.role;
  if (!can(role, "quotations.view")) notFound();
  const q = await getQuotationDetail(id, qid);
  if (!q) notFound();

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/projects" className="hover:text-foreground">Projects</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/projects/${q.project.id}`} className="max-w-[240px] truncate hover:text-foreground">{q.project.name}</Link><ChevronRight className="h-3.5 w-3.5" />
        <Link href={`/projects/${q.project.id}/quotations`} className="hover:text-foreground">Quotations</Link><ChevronRight className="h-3.5 w-3.5" />
        <span className="font-medium text-foreground">{q.number}{q.revision ? ` Rev. ${q.revision}` : ""}</span>
      </nav>
      <QuotationDetail key={`${q.id}:${q.status}:${q.events.length}`} q={q} canEdit={can(role, "quotations.edit")} canApprove={can(role, "quotations.approve")} />
    </div>
  );
}
