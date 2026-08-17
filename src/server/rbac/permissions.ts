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
  "projects.delete": ["ADMIN"],

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
