# Per-row area formula (Add / Subtract) + visible equations

## What this fixes
The "PL 10 mm" example (Ext 0.4×0.4, Int 0.3×0.3) was always computed as
duct-style: Ext area + Int area = 0.500 m². That's correct for a duct
section with two separate wall skins, but wrong for a flat plate with a
cutout, whose true area is Ext − Int = 0.07 m².

There was only one hard-coded formula for every row. Now every row has:

1. A **Shape** dropdown: "Ext + Int" (default, unchanged behaviour) or
   "Ext − Int" (new — subtracts the cutout).
2. A **ƒx button** next to Weight — click it to expand the row and see the
   exact equation used for T. Area, Paint Area, Volume, and Weight, with
   that row's own numbers plugged in.

## Formula reference
- ADD (duct, default):      totalUnitArea = (ExtW×ExtL×2) + (IntW×IntL×2)
- SUBTRACT (plate/cutout):  totalUnitArea = max(0, (ExtW×ExtL×2) − (IntW×IntL×2))
- totalArea   = totalUnitArea × qty
- volume      = (totalArea / 2) × thicknessMm
- weightKg    = volume × 7.85
- paintAreaSqm = (totalArea / 2) × paintSides

Switching a row to SUBTRACT never touches any other row — every part keeps
its own Shape setting, saved individually.

## Also fixed
The drawing header ("Total Area / Paint Area / Total Weight") was showing
`NaN` for the Paint Area whenever a part predating the Paint Sides feature
had a `null` value in the database. The totals now treat a missing value
as 0 instead of poisoning the whole sum.

## Files changed
- prisma/schema.prisma                    — +TakeoffAreaMode enum, +areaMode column (default ADD, safe migration)
- src/server/calc/takeoff.ts               — areaMode support in computeTakeoffPart; new explainTakeoffPart() for the equation text
- src/server/validators/takeoff.ts         — +areaMode ("ADD" | "SUBTRACT"), default "ADD"
- src/server/services/takeoff.service.ts   — create/update/bulk now persist areaMode
- src/features/takeoff/types.ts            — +areaMode on TakeoffPartRow
- src/features/takeoff/parts-grid.tsx      — Shape dropdown column, ƒx toggle + expandable equation row
- src/features/takeoff/takeoff-view.tsx    — guard header totals against null/NaN values

## How to apply
1. Copy the files above into your project at the same paths (this zip
   already has the full merged tree — real-data-seed + grid-entry + paint
   patches are all included, so you can just copy the whole thing over).
2. Run a migration for the new column:
   npx prisma migrate dev --name add_area_mode
   (existing rows automatically get areaMode = ADD, so nothing recalculates
   differently until you explicitly change a row's Shape.)
3. For the "PL 10 mm" row in your screenshot: open it in the grid, change
   Shape to "Ext − Int", hit the ✓ Save. T. Area becomes 0.140 m² (both
   faces) / Paint Area becomes 0.070 m² (1 side) — i.e. 0.4×0.4 − 0.3×0.3.
4. Click the ƒx icon on any row any time to double check the math.

## Note on verification
This environment's network allowlist blocks Prisma's binary download
(binaries.prisma.sh), so I couldn't run a full `prisma generate` +
`next build` here. I did run `tsc --noEmit` against the whole project —
zero errors in any of the changed files (the only errors reported are the
pre-existing Prisma-client-stub issue affecting the *entire* codebase,
unrelated to this change) — and unit-verified the math in isolation:
SUBTRACT mode on your exact numbers gives paintAreaSqm = 0.4×0.4−0.3×0.3
exactly, and ADD mode reproduces the original 0.500 m² / 19.6 kg untouched.
Please still do a normal `npx prisma migrate dev` + a quick click-through
before shipping to production.
