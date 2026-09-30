"use client";
import * as React from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { Topbar } from "./topbar";
import { NAV_ITEMS } from "@/lib/nav-config";
import type { Role } from "@prisma/client";

const SUBTITLES: Record<string, string> = {
  "/dashboard": "Operational overview across all active projects",
  "/projects": "Manage engineering projects and their lifecycle",
  "/customers": "Manage your customer directory",
  "/documents": "Project documents, drawings and specifications",
  "/reports": "Operational reporting across the platform",
  "/users": "Manage platform users and access",
  "/settings": "Configure company, system and workflow settings",
  "/docs": "How to use every feature of the Calculations tabs",
};

export function AppShell({
  user,
  children,
}: {
  user: { name: string; email: string; role: Role };
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  // desktop sidebar open/closed; remembered between visits (read after mount so server and client HTML match)
  const [sidebarOpen, setSidebarOpen] = React.useState(true);
  React.useEffect(() => {
    try {
      if (localStorage.getItem("sidebar-open") === "0") setSidebarOpen(false);
    } catch {}
  }, []);
  const toggleSidebar = React.useCallback(() => {
    setSidebarOpen((v) => {
      try {
        localStorage.setItem("sidebar-open", v ? "0" : "1");
      } catch {}
      return !v;
    });
  }, []);
  // Ctrl/Cmd+B toggles it, except while typing in a field
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "b") return;
      if ((e.target as HTMLElement | null)?.closest?.("input,textarea,select,[contenteditable=true]")) return;
      e.preventDefault();
      toggleSidebar();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);
  const pathname = usePathname();
  const activeItem = NAV_ITEMS.find((i) => pathname.startsWith(i.href));
  const title = activeItem?.label ?? "SteelFlow ERP";
  const subtitle = activeItem ? SUBTITLES[activeItem.href] : undefined;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar role={user.role} open={sidebarOpen} />
      <MobileNav role={user.role} open={mobileOpen} onOpenChange={setMobileOpen} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar title={title} subtitle={subtitle} user={user} onToggleSidebar={() => setMobileOpen(true)} sidebarOpen={sidebarOpen} onToggleDesktopSidebar={toggleSidebar} />
        <main className="flex-1 space-y-6 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}