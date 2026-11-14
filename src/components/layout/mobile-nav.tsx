"use client";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { visibleNavItems } from "@/lib/nav-config";
import { NavList } from "./nav-list";
import { SidebarBackdrop } from "./sidebar-backdrop";
import type { Role } from "@prisma/client";

export function MobileNav({ role, open, onOpenChange }: { role: Role; open: boolean; onOpenChange: (v: boolean) => void }) {
  const items = visibleNavItems(role);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-0 top-0 h-full max-h-full w-72 max-w-[80vw] translate-x-0 translate-y-0 relative overflow-hidden rounded-none border-0 bg-sidebar p-0 text-sidebar-foreground data-[state=open]:slide-in-from-left">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <SidebarBackdrop />
        <div className="relative flex h-16 items-center gap-2.5 px-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-icon.png" alt="SteelFlow" className="h-8 w-8 shrink-0 object-contain" />
          <p className="text-sm font-semibold text-white">SteelFlow</p>
        </div>
        <nav className="relative space-y-1 p-3">
          <NavList items={items} onNavigate={() => onOpenChange(false)} />
        </nav>
      </DialogContent>
    </Dialog>
  );
}
