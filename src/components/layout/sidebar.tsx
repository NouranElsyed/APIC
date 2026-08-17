"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { visibleNavItems } from "@/lib/nav-config";
import type { Role } from "@prisma/client";

export function Sidebar({ role, collapsed }: { role: Role; collapsed?: boolean }) {
  const pathname = usePathname();
  const items = visibleNavItems(role);

  return (
    <aside
      className={cn(
        "hidden md:flex h-screen flex-col bg-sidebar text-sidebar-foreground transition-all duration-200",
        collapsed ? "w-[76px]" : "w-64"
      )}
    >
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
          <LayoutGrid className="h-4.5 w-4.5" />
        </div>
        {!collapsed && (
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">SteelFlow</p>
            <p className="text-[11px] text-sidebar-foreground/70">Core Platform</p>
          </div>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-active text-sidebar-active-foreground"
                  : "text-sidebar-foreground/80 hover:bg-sidebar-active/50 hover:text-white"
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-4.5 w-4.5 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="border-t border-sidebar-border p-4">
          <p className="text-[11px] leading-relaxed text-sidebar-foreground/50">
            SteelFlow ERP — Phase 1
            <br />
            Core Platform Foundation
          </p>
        </div>
      )}
    </aside>
  );
}
