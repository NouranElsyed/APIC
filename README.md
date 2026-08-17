# SteelFlow ERP — Phase 1 (Core Platform)

A production-ready full-stack Next.js application: the reusable business
platform foundation for a future Steel Pricing & Scrap Management system.

**Phase 1 scope, by design:** authentication, RBAC, Projects, Customers,
Documents, Reports, User Management, and Settings. **No pricing, scrap,
cost reconciliation, or engineering calculation logic is implemented** —
see [Phase 2 readiness](#phase-2-readiness) below for how the codebase is
already shaped to accept that module without restructuring.

---

## Tech Stack

- Next.js 15 (App Router) + TypeScript
- Tailwind CSS v4 + hand-built shadcn/ui-style component library
- Prisma ORM + PostgreSQL
- Auth.js (NextAuth) v5 — credentials provider, JWT sessions
- React Hook Form + Zod
- TanStack Table (client-side data tables)
- Recharts (dashboard charts)
- ESLint

## Getting Started

### 1. Prerequisites

- Node.js 20+
- A PostgreSQL 14+ database (local, Docker, or hosted)

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your Postgres connection string.
If you don't have Postgres running locally, the included
`docker-compose.yml` will start one for you:

```bash
docker compose up -d
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/steelflow?schema=public"
```

Generate a real secret for `NEXTAUTH_SECRET` in production:

```bash
openssl rand -base64 32
```

### 4. Set up the database

```bash
npx prisma migrate dev --name init   # creates tables from prisma/schema.prisma
npm run db:seed                      # seeds 20 projects, 10 customers, 8 users, 30 documents
```

### 5. Run the app

```bash
npm run dev
```

Visit http://localhost:3000 — you'll be redirected to `/login`.

### Demo accounts (password: `password123`)

| Role     | Email                     |
| -------- | -------------------------- |
| Admin    | admin@steelflow.com        |
| Manager  | manager@steelflow.com      |
| Engineer | engineer@steelflow.com     |
| Viewer   | viewer@steelflow.com       |

The login screen has one-click buttons to fill these in.

---

## Architecture

Layered architecture — business logic never lives inside UI components.

```
src/
  app/                  # Next.js App Router routes only (thin)
    (auth)/login/
    (app)/dashboard|projects|customers|documents|reports|users|settings/
    api/                # Route handlers — call server/services, never Prisma directly
  components/
    ui/                 # Design-system primitives (button, card, table, dialog, ...)
    layout/             # Sidebar, topbar, app shell
    shared/             # KpiCard, DataTable, SearchBar, FilterPanel, EmptyState, ConfirmDialog
  features/             # Feature UIs (client components), grouped by module
    projects/ customers/ documents/ users/ reports/ settings/ dashboard/ auth/
    phase2-pricing/      # RESERVED — not implemented, see below
    phase2-scrap/        # RESERVED — not implemented, see below
  server/
    auth/               # Auth.js config
    rbac/               # Central permission matrix
    db/                 # Prisma client singleton
    services/           # Business logic — the only layer that talks to Prisma
    validators/         # Zod schemas (shared by forms and API routes)
    api/                # requireSession / requirePermission guards for route handlers
  lib/                  # cn(), formatDate(), nav-config
prisma/
  schema.prisma
  seed.ts
```

**Request flow:** UI (`features/*`) -> `fetch("/api/...")` -> route handler
(`app/api/**/route.ts`) -> RBAC guard (`server/api/guard.ts`) -> service
(`server/services/*`) -> Prisma -> PostgreSQL.

## Authentication & RBAC

- Credentials-based login (email + password, bcrypt-hashed), JWT sessions
  via Auth.js v5.
- Roles: `ADMIN`, `MANAGER`, `ENGINEER`, `VIEWER`.
- `src/server/rbac/permissions.ts` is the single source of truth for what
  each role can do; both API routes and page-level UI (buttons, nav items)
  read from it — no duplicated role checks scattered through the app.
- `src/middleware.ts` protects all routes except `/login` and gates
  `/users` and `/settings` to `ADMIN` only.

## Database Schema

See `prisma/schema.prisma`. Core models: `User`, `Customer`, `Project`,
`Document`, `ActivityLog`, `CompanySettings`, `ProjectStatusConfig`.

## File Uploads

Document uploads are written to `public/uploads/` (local disk — suitable
for development, as specified). Swapping this for S3/Azure Blob/etc. later
only touches `src/app/api/documents/route.ts`; the `Document` model and
the rest of the app are storage-agnostic.

## Phase 2 Readiness

Phase 1 was deliberately architected so pricing/scrap/cost-reconciliation
can be added later **without restructuring**:

- `src/features/phase2-pricing/README.md` and `phase2-scrap/README.md`
  document the exact integration points.
- `Project` (in `prisma/schema.prisma`) is a stable anchor model. New
  Phase 2 models (e.g. `Quotation`, `MaterialUsage`, `ScrapEntry`,
  `CostSummary`) attach via a `projectId` foreign key — no changes to
  `Project` itself are required.
- `src/lib/nav-config.ts` has a commented-out Phase 2 section
  (Pricing / Scrap Management / Cost Summary / Material Usage) ready to
  uncomment and gate by role once that module ships.
- `src/server/rbac/permissions.ts` is where new permission keys such as
  `pricing.view` / `pricing.edit` get added — same pattern as everything
  else in the matrix.
- New API routes follow the existing `src/app/api/<module>/route.ts` +
  `src/app/api/<module>/[id]/route.ts` pattern.

## Available Scripts

| Command              | Description                                  |
| --------------------- | --------------------------------------------- |
| `npm run dev`          | Start the dev server                          |
| `npm run build`        | Production build                              |
| `npm run start`        | Start the production server                   |
| `npm run lint`         | Run ESLint                                    |
| `npm run db:migrate`   | Run Prisma migrations (`prisma migrate dev`)  |
| `npm run db:seed`      | Seed the database                             |
| `npm run db:studio`    | Open Prisma Studio                            |

## Notes on this build

- Verified with a full TypeScript project check (`tsc --noEmit`, 0 errors)
  and a full production `next build` (all pages and API routes compile).
- `prisma generate` / `prisma migrate` need to reach Prisma's engine
  download CDN the first time you install — this is normal and works out
  of the box on a machine with regular internet access.
