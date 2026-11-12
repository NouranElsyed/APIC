"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarRange, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

/** Section tabs shown under a project's header (Overview · Planning). */
export function ProjectTabs({ projectId, showPlanning = true }: { projectId: string; showPlanning?: boolean }) {
  const pathname = usePathname();
  const tabs = [
    { href: `/projects/${projectId}`, label: "Overview", icon: LayoutDashboard, active: pathname === `/projects/${projectId}` },
    ...(showPlanning ? [{ href: `/projects/${projectId}/planning`, label: "Planning", icon: CalendarRange, active: pathname.startsWith(`/projects/${projectId}/planning`) }] : []),
  ];
  return (
    <nav className="flex gap-1 border-b border-border">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={cn("-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors", t.active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>
          <t.icon className="h-4 w-4" /> {t.label}
        </Link>
      ))}
    </nav>
  );
}
