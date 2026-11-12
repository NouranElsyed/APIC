"use client";
import { cn } from "@/lib/utils";
import { NavList } from "./nav-list";
import { visibleNavItems } from "@/lib/nav-config";
import type { Role } from "@prisma/client";

export function Sidebar({ role, collapsed, open = true }: { role: Role; collapsed?: boolean; open?: boolean }) {
  const items = visibleNavItems(role);

  return (
    <aside
      className={cn(
        "hidden h-screen flex-col bg-sidebar text-sidebar-foreground transition-all duration-200",
        open ? "md:flex" : "md:hidden",
        collapsed ? "w-[76px]" : "w-64"
      )}
    >
      <div className="flex h-16 items-center gap-2.5 px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-icon.png" alt="SteelFlow" className="h-8 w-8 shrink-0 object-contain" />
        {!collapsed && (
          <p className="text-sm font-semibold text-white">SteelFlow</p>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        <NavList items={items} collapsed={collapsed} />
      </nav>
    </aside>
  );
}