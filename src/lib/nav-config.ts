import {
  LayoutDashboard, FolderKanban, Users2, UserCog, Settings, Ruler,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@prisma/client";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles?: Role[]; // omit = visible to all authenticated roles
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Projects", href: "/projects", icon: FolderKanban },
  { label: "Clients", href: "/customers", icon: Users2 },
  // { label: "Documents", href: "/documents", icon: FileText },
  { label: "Calculations", href: "/calculations", icon: Ruler },
  // { label: "Reports", href: "/reports", icon: BarChart3 },
  { label: "Users", href: "/users", icon: UserCog, roles: ["ADMIN"] },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["ADMIN"] },

  // ---------------------------------------------------------------------
  // Phase 2 (reserved — do not enable until pricing/scrap module ships):
  // { label: "Pricing", href: "/pricing", icon: DollarSign },
  // { label: "Scrap Management", href: "/scrap", icon: Recycle },
  // { label: "Cost Summary", href: "/cost-summary", icon: PieChart },
  // { label: "Material Usage", href: "/material-usage", icon: Boxes },
  // ---------------------------------------------------------------------
];

export function visibleNavItems(role: Role | undefined) {
  return NAV_ITEMS.filter((item) => !item.roles || (role && item.roles.includes(role)));
}
