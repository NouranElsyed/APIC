# Takeoff real-data seed

Files:
- prisma/seed/takeoff-data.json  — 9 drawings / 114 parts, extracted directly
  from "Riser Duct Fabrication Drg" in calculate_area_formatted.xlsx
  (numbers taken from the sheet's own computed cells, not recalculated).
- prisma/seed/seed-takeoff.ts    — loads that JSON into TakeoffDrawing /
  TakeoffPart, attached to project PRJ-2026-001 (Riser Duct Fabrication).

How to run:
1. Copy both files into your project at the same paths (prisma/seed/...),
   alongside the existing prisma/seed.ts.
2. Make sure the base seed has run first (creates the project + admin user):
   npx prisma db seed
3. Run the takeoff seed:
   npx tsx prisma/seed/seed-takeoff.ts
4. Open the app -> Takeoff -> Riser Duct Fabrication project. All 9
   drawings and 114 parts will be there with real weights/areas.

Safe to re-run: it skips any drawing number already present for the project.
