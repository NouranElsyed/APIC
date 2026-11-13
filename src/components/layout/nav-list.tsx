"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavChild, NavItem } from "@/lib/nav-config";

const row = "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
const on = "bg-sidebar-active text-sidebar-active-foreground";
const off = "text-sidebar-foreground/80 hover:bg-sidebar-active/50 hover:text-white";

/** Shared by the desktop sidebar and the mobile drawer. */
export function NavList({ items, collapsed, onNavigate }: { items: NavItem[]; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  // Inside a project, "Planning" opens that project's schedule; elsewhere it opens the latest one.
  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const inProject = projectId && projectId !== "new" ? projectId : null;
  const hrefFor = (c: NavChild) =>
    c.key === "planning" ? (inProject ? `/projects/${inProject}/planning` : "/planning")
    : c.key === "quotations" ? (inProject ? `/projects/${inProject}/quotations` : "/quotations")
    : c.key === "documents" ? (inProject ? `/projects/${inProject}/documents` : "/documents")
    : c.href!;

  const childActive = (c: NavChild) =>
    c.key === "planning" ? pathname.includes("/planning")
    : c.key === "quotations" ? pathname.includes("/quotations")
    : c.key === "documents" ? pathname.includes("/documents")
    : c.key === "list" ? pathname === "/projects" || (pathname.startsWith("/projects/") && !pathname.includes("/planning") && !pathname.includes("/quotations") && !pathname.includes("/documents"))
    : false;

  return (
    <>
      {items.map((item) => (
        <Item key={item.href} item={item} collapsed={collapsed} pathname={pathname} hrefFor={hrefFor} childActive={childActive} onNavigate={onNavigate} />
      ))}
    </>
  );
}

function Item({ item, collapsed, pathname, hrefFor, childActive, onNavigate }: {
  item: NavItem; collapsed?: boolean; pathname: string; hrefFor: (c: NavChild) => string; childActive: (c: NavChild) => boolean; onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const groupActive = pathname.startsWith(item.href) || (!!item.children && (pathname.startsWith("/planning") || pathname.startsWith("/quotations") || pathname.startsWith("/documents")));
  const [expanded, setExpanded] = React.useState(true);

  if (!item.children) {
    return (
      <Link href={item.href} onClick={onNavigate} title={collapsed ? item.label : undefined} className={cn(row, pathname.startsWith(item.href) ? on : off)}>
        <Icon className="h-4.5 w-4.5 shrink-0" />
        {!collapsed && <span>{item.label}</span>}
      </Link>
    );
  }
  return (
    <div>
      <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} title={collapsed ? item.label : undefined} className={cn(row, "w-full", groupActive ? on : off)}>
        <Icon className="h-4.5 w-4.5 shrink-0" />
        {!collapsed && <><span className="flex-1 text-left">{item.label}</span>{expanded ? <ChevronDown className="h-4 w-4 opacity-70" /> : <ChevronRight className="h-4 w-4 opacity-70" />}</>}
      </button>
      {expanded && !collapsed && (
        <div className="mt-1 space-y-0.5 pl-3">
          {item.children.map((c) => {
            const CIcon = c.icon;
            if (c.soon) {
              return (
                <span key={c.key} aria-disabled title="Coming soon" className={cn(row, "cursor-not-allowed py-1.5 text-[13px] text-sidebar-foreground/40")}>
                  <CIcon className="h-4 w-4 shrink-0" /><span className="flex-1">{c.label}</span>
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">Soon</span>
                </span>
              );
            }
            return (
              <Link key={c.key} href={hrefFor(c)} onClick={onNavigate} className={cn(row, "py-1.5 text-[13px]", childActive(c) ? on : off)}>
                <CIcon className="h-4 w-4 shrink-0" />{c.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
