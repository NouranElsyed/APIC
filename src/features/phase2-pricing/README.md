# Phase 2 — Pricing & Cost Reconciliation (not implemented)

This folder is a reserved extension point. Phase 1 intentionally contains
no pricing, cost, or quotation logic.

When Phase 2 begins, this module will own:
- Quotation / pricing-per-project calculations
- Material cost components & price lists
- Cost Summary dashboards (Total Purchase Cost, Value Recovered, etc.)

Planned integration points already exist in Phase 1 to avoid restructuring:
- `Project` (prisma/schema.prisma) is a stable anchor — new models attach via
  `projectId` foreign keys, no changes to `Project` needed.
- Sidebar nav config (`src/lib/nav-config.ts`) has a commented Phase 2 section
  ready to enable per-role.
- RBAC matrix (`src/server/rbac/permissions.ts`) is where new permission keys
  such as `pricing.view` / `pricing.edit` will be added.
- `/api` route-handler layout has no pricing routes yet; add
  `src/app/api/pricing/*` following the same pattern as `src/app/api/projects`.
