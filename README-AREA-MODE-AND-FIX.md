# Area Mode (Add/Subtract) + formula viewer + NaN fix

## 1. Bug fix — NaN in the drawing header
Some rows that hadn't gone through the newer save path had a null value in
one of the newer numeric columns; summing null + number = NaN in
JavaScript. All totals (drawing header AND the grid footer) now coerce
every value defensively before summing, so a bad/legacy row can no longer
turn the whole total into NaN. Root data cleanup: if a drawing's header
total still looks wrong after this, open each row's ƒx panel (see below)
to spot the row with missing dimensions, fix it, and save.

## 2. Area Mode: Add vs Subtract (your PL 10mm example)
New per-row dropdown "Area Mode": Ext + Int (Add) or Ext − Int (Subtract).

- **Ext + Int** (old default) — for parts where internal dims are a
  SEPARATE surface, like a duct's inner + outer wall. Both get added.
- **Ext − Int** (new) — for a flat plate with a hole/cut-out, where the
  internal dims are material REMOVED from the outer footprint:
  netArea = extWidth×extLength − intWidth×intLength
  This is exactly your case: 0.4×0.4 − 0.3×0.3 = 0.07 m² per face.

Weight is always driven correctly by whichever mode is picked — Subtract
mode does NOT double-count, and painting area (1/2 sides) still layers on
top the same way for either mode.

## 3. See the equation for any row
Every row now has a ƒx button (before the Save/Delete icons). Clicking it
expands an inline panel below that row showing every step — ext area, int
area, total area, volume, weight, paint area — with the row's actual
numbers substituted in, so you can check/audit the calculation directly
instead of trusting a black box. Click ƒx again (now an ✕) to collapse it.

## Files changed (copy over the same paths)
- prisma/schema.prisma                  — +TakeoffAreaMode enum, +areaMode column on TakeoffPart
- prisma/seed/seed-takeoff.ts           — real Excel data marked as areaMode "ADD" (duct walls)
- src/server/calc/takeoff.ts            — Add/Subtract logic + explainTakeoffPart() for the formula viewer, NaN-safe sums
- src/server/validators/takeoff.ts      — +areaMode validation
- src/server/services/takeoff.service.ts — create/update/bulk now store areaMode
- src/features/takeoff/types.ts         — +areaMode
- src/features/takeoff/parts-grid.tsx   — Area Mode column, ƒx formula panel, NaN-safe footer totals
- src/features/takeoff/takeoff-view.tsx — NaN-safe header totals

## How to apply
1. Copy all files above into your project at the same paths.
2. Migration (new enum + column):
   npx prisma migrate dev
   (name it e.g. add_area_mode)
3. For the "PL 10mm" (or any similar hole-in-plate) row: open it in the
   grid, set Area Mode to "Ext − Int", fill in the outer (0.4×0.4) as
   Ext W/L and the hole (0.3×0.3) as Int W/L, save, then click ƒx to
   confirm the numbers.
