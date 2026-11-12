"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarRange, FileText, FolderOpen, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section tabs under a project's header. Screens that do not exist yet are shown greyed-out. */
export function ProjectTabs({ projectId, showPlanning = true }: { projectId: string; showPlanning?: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/projects/${projectId}`, label: "Overview", icon: LayoutDashboard, active: pathname === `/projects/${projectId}` },
    ...(showPlanning ? [{ href: `/projects/${projectId}/planning`, label: "Planning", icon: CalendarRange, active: pathname.startsWith(`/projects/${projectId}/planning`) }] : []),
    { label: "Quotations", icon: FileText },
    { label: "Documents", icon: FolderOpen },
    { label: "Reports", icon: BarChart3 },
  ] as { href?: string; label: string; icon: typeof FileText; active?: boolean }[];
  const base = "-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-medium transition-colors";
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) =>
        t.href ? (
          <Link key={t.label} href={t.href} className={cn(base, t.active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </Link>
        ) : (
          <span key={t.label} aria-disabled title="Coming soon" className={cn(base, "cursor-not-allowed border-transparent text-muted-foreground/50")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </span>
        )
      )}
    </nav>
  );
}
