// ============================================================================
// Central RBAC permission matrix.
// Every server action / API route checks against this table instead of
// scattering role checks through the codebase. Add rows here as Phase 2
// modules (pricing, scrap) introduce new permission keys.
// ============================================================================

import type { Role } from "@prisma/client";

export const PERMISSIONS = {
  "projects.view": ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"],
  "projects.create": ["ADMIN", "MANAGER", "ENGINEER"],
  "projects.edit": ["ADMIN", "MANAGER", "ENGINEER"],
  "projects.delete": ["ADMIN", "MANAGER", "ENGINEER"],

  "customers.view": ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"],
  "customers.create": ["ADMIN", "MANAGER"],
  "customers.edit": ["ADMIN", "MANAGER"],
  "customers.delete": ["ADMIN"],

  "documents.view": ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"],
  "documents.create": ["ADMIN", "MANAGER", "ENGINEER"],
  "documents.delete": ["ADMIN", "MANAGER"],

  "reports.view": ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"],

  "takeoff.view": ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"],
  "takeoff.create": ["ADMIN", "MANAGER", "ENGINEER"],
  "takeoff.edit": ["ADMIN", "MANAGER", "ENGINEER"],
  "takeoff.delete": ["ADMIN", "MANAGER"],

  // DXF Nesting — mirrors the takeoff permission tiers so anyone who can
  // work with Calculations can also work with the Nesting workflow built
  // on top of it.
  "nesting.view": ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"],
  "nesting.create": ["ADMIN", "MANAGER", "ENGINEER"],
  "nesting.edit": ["ADMIN", "MANAGER", "ENGINEER"],
  "nesting.delete": ["ADMIN", "MANAGER"],

  // Scrap & Material pricing — restricted to ADMIN (Nouran Elsayed).
  "scrapPricing.view": ["ADMIN"],
  "scrapPricing.export": ["ADMIN"],

  // Steel Structures Pricing Engine — rebuilds the original pricing sheet as
  // one editable page (rate card, single-item calculator, full BOQ).
  "steelPricing.view": ["ADMIN"],
  "steelPricing.export": ["ADMIN"],

  // Planning & follow-up (Primavera-style schedule). Anyone can view; editing the
  // schedule / recording progress follows the project-edit tiers; deleting a whole
  // schedule is limited to managers and admins.
  "planning.view": ["ADMIN", "MANAGER", "ENGINEER", "VIEWER"],
  "planning.edit": ["ADMIN", "MANAGER", "ENGINEER"],
  "planning.delete": ["ADMIN", "MANAGER"],

  // Quotations carry prices and margins, so they are limited to managers and admins;
  // only an admin can approve / reject or delete one.
  "quotations.view": ["ADMIN", "MANAGER"],
  "quotations.edit": ["ADMIN", "MANAGER"],
  "quotations.approve": ["ADMIN"],
  "quotations.delete": ["ADMIN"],

  "users.manage": ["ADMIN"],
  "settings.manage": ["ADMIN"],
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: PermissionKey): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly string[]).includes(role);
}

export function assertCan(role: Role | undefined | null, permission: PermissionKey) {
  if (!can(role, permission)) {
    throw new Error(`Forbidden: role "${role}" lacks permission "${permission}"`);
  }
}
