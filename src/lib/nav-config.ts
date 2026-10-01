import {
  LayoutDashboard, FolderKanban, Users2, UserCog, Settings, Ruler, BookOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@prisma/client";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles?: Role[]; // omit = visible to all authenticated roles
  hidden?: boolean; // kept (routes + page titles still work) but not shown in the sidebar / mobile menu for now
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, hidden: true },
  { label: "Projects", href: "/projects", icon: FolderKanban, hidden: true },
  { label: "Clients", href: "/customers", icon: Users2, hidden: true },
  // { label: "Documents", href: "/documents", icon: FileText },
  { label: "Nesting & Costing", href: "/takeoff", icon: Ruler },
  // { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Users", href: "/users", icon: UserCog, roles: ["ADMIN"], hidden: true },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["ADMIN"], hidden: true },
  { label: "Docs", href: "/docs", icon: BookOpen },

  // ---------------------------------------------------------------------
  // Phase 2 (reserved — do not enable until pricing/scrap module ships):
  // { label: "Pricing", href: "/pricing", icon: DollarSign },
  // { label: "Scrap Management", href: "/scrap", icon: Recycle },
  // { label: "Cost Summary", href: "/cost-summary", icon: PieChart },
  // { label: "Material Usage", href: "/material-usage", icon: Boxes },
  // ---------------------------------------------------------------------
];

export function visibleNavItems(role: Role | undefined) {
  return NAV_ITEMS.filter((item) => !item.hidden).filter((item) => !item.roles || (role && item.roles.includes(role)));
}
