import {
  LayoutDashboard, FolderKanban, Users2, UserCog, Settings, Ruler, BookOpen,
  List, CalendarRange, FileText, Boxes, PieChart, BarChart3, Recycle, FolderOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Role } from "@prisma/client";

export interface NavChild {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  soon?: boolean; // shown greyed-out until its screen exists
}

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  roles?: Role[]; // omit = visible to all authenticated roles
  children?: NavChild[]; // sub-menu shown under the item (e.g. Projects)
  hidden?: boolean; // kept (routes + page titles still work) but not shown in the sidebar / mobile menu for now
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, hidden: true },
  {
    label: "Projects", href: "/projects", icon: FolderKanban, roles: ["ADMIN"],
    children: [
      { key: "list", label: "Projects List", icon: List, href: "/projects" },
      { key: "planning", label: "Planning", icon: CalendarRange, href: "/planning" },
      { key: "quotations", label: "Quotations", icon: FileText, href: "/quotations" },
      { key: "material", label: "Material & Usage", icon: Boxes, href: "/material-usage" },
      { key: "cost", label: "Cost & Summary", icon: PieChart, soon: true },
      { key: "documents", label: "Documents", icon: FolderOpen, href: "/documents" },
      { key: "reports", label: "Reports", icon: BarChart3, href: "/reports" },
      { key: "scrap", label: "Scrap Management", icon: Recycle, soon: true },
    ],
  },
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
