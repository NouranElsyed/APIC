"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { visibleNavItems } from "@/lib/nav-config";
import { cn } from "@/lib/utils";
import type { Role } from "@prisma/client";
import { LayoutGrid } from "lucide-react";

export function MobileNav({ role, open, onOpenChange }: { role: Role; open: boolean; onOpenChange: (v: boolean) => void }) {
  const pathname = usePathname();
  const items = visibleNavItems(role);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="left-0 top-0 h-full max-h-full w-72 max-w-[80vw] translate-x-0 translate-y-0 rounded-none border-0 bg-sidebar p-0 text-sidebar-foreground data-[state=open]:slide-in-from-left">
        <DialogTitle className="sr-only">Navigation</DialogTitle>
        <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white">
            <LayoutGrid className="h-4.5 w-4.5" />
          </div>
          <p className="text-sm font-semibold text-white">SteelFlow</p>
        </div>
        <nav className="space-y-1 p-3">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
                  active ? "bg-sidebar-active text-white" : "text-sidebar-foreground/80 hover:bg-sidebar-active/50"
                )}
              >
                <Icon className="h-4.5 w-4.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
