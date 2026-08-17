# Paint area (1/2 sides) + always-on inline grid

## 1. Paint area, independent of weight
Every part now has a "Paint Sides" choice (1 or 2), stored separately from
the weight calculation:

- Weight/volume: unchanged, still driven by totalArea (both faces, as before).
- New: paintAreaSqm = (totalArea / 2) * paintSides
  - paintSides = 2 (default) -> paintAreaSqm == totalArea (both faces painted)
  - paintSides = 1 -> paintAreaSqm == totalArea / 2 (one face only)

Changing paintSides never touches volume/weightKg — verified in
src/server/calc/takeoff.ts (computeTakeoffPart).

Schema change (needs a migration):
  model TakeoffPart {
    ...
    paintSides   Int   @default(2)
    paintAreaSqm Float @default(0)
  }

## 2. Grid is now the only entry method — always visible
Removed the "Add Part" / "Grid Entry" dialogs. Every drawing now shows an
Excel-style table inline, always open, with 3 empty buffer rows at the
bottom ready to type into. Each row has its own Save (✓) button — save one
row, a fresh blank row appears automatically. No more opening a form
every time you add a part.

New/changed files:
- prisma/schema.prisma                       — +paintSides, +paintAreaSqm on TakeoffPart
- prisma/seed/seed-takeoff.ts                 — updated to fill the new columns for the real Excel data
- src/server/calc/takeoff.ts                  — paintAreaSqm calc, independent of weight
- src/server/validators/takeoff.ts            — +paintSides (1|2) validation
- src/server/services/takeoff.service.ts      — createPart/updatePart/createPartsBulk store paintSides/paintAreaSqm
- src/features/takeoff/types.ts               — +paintSides, +paintAreaSqm
- src/features/takeoff/parts-grid.tsx         — NEW: the always-visible inline grid (replaces part-form.tsx / part-grid-entry.tsx usage)
- src/features/takeoff/takeoff-view.tsx       — renders PartsGrid inline per drawing; drawing header now also shows total Paint Area

Old files src/features/takeoff/part-form.tsx and part-grid-entry.tsx are
no longer imported anywhere — safe to delete from your project, or leave
them unused.

## How to apply
1. Copy all files above into your project at the same paths.
2. Run a migration (new columns):
   npx prisma migrate dev
   (name it e.g. add_paint_sides)
3. If you want the real Excel data reseeded with the new columns filled in:
   npx tsx prisma/seed/seed-takeoff.ts
   (safe to re-run — skips drawings already present; if you already
   seeded before this change, delete the existing takeoff_parts rows for
   that project first, or just add new parts through the grid.)
