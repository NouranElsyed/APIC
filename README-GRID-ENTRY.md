# Takeoff — Grid Entry (Excel-style) option

Adds a second way to enter parts under a drawing, alongside the existing
one-row-at-a-time "Add Part" form: a "Grid Entry" table where you type
rows directly (item, description, ext W/L, int W/L, qty, thickness) like
the Excel sheet, with area/weight computed live per row, then saved in
one batch.

Where it shows up:
- Next to "Add Part" on every drawing's header.
- As a second button in the empty state ("No parts entered yet").

Files (copy into your project at the same paths):
- src/server/validators/takeoff.ts        (added bulk row/array schema)
- src/server/services/takeoff.service.ts  (added createPartsBulk)
- src/app/api/takeoff/parts/bulk/route.ts (new — POST /api/takeoff/parts/bulk)
- src/features/takeoff/part-grid-entry.tsx (new — the grid dialog)
- src/features/takeoff/takeoff-view.tsx   (wired the new button + dialog in)

No schema/migration changes — same TakeoffPart table, same server-side
recompute (computeTakeoffPart) as the single-part form, so grid rows are
calculated identically to Add Part. No new deps.
