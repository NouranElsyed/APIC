// Loads the REAL "Riser Duct Fabrication Drg" sheet data (extracted from
// calculate_area_formatted.xlsx) into the Takeoff module.
//
// Source of truth for the numeric fields (extUnitArea, intUnitArea,
// totalUnitArea, totalArea, volume, weightKg): taken directly from the
// Excel sheet's own computed cells for each row, NOT recalculated from
// raw width/length here. Some rows in the sheet (curved/riser plate
// segments) don't reduce to the simple W*L*2 formula — their W/L are
// stored for reference but the sheet's own area/weight output is what
// gets written, so every number in the DB matches the spreadsheet exactly.
//
// Run with:
//   npx tsx prisma/seed/seed-takeoff.ts
//
// Requires the base seed (prisma/seed.ts) to have run first, since it
// creates the "PRJ-2026-001" project (Riser Duct Fabrication) and the
// admin user this script attaches records to.

import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

interface TakeoffPartRow {
  itemLabel: string;
  description: string;
  extWidth: number | null;
  extLength: number | null;
  extUnitArea: number | null;
  intWidth: number | null;
  intLength: number | null;
  intUnitArea: number | null;
  totalUnitArea: number | null;
  qty: number;
  totalArea: number | null;
  thicknessMm: number;
  volume: number | null;
  weightKg: number;
}

interface TakeoffDrawingRow {
  drawingNumber: string;
  title: string;
  weightFromDwg: number | null;
  parts: TakeoffPartRow[];
}

async function main() {
  const dataPath = path.join(__dirname, "takeoff-data.json");
  const drawings: TakeoffDrawingRow[] = JSON.parse(fs.readFileSync(dataPath, "utf-8"));

  const project = await prisma.project.findUnique({ where: { number: "PRJ-2026-001" } });
  if (!project) {
    throw new Error(
      'Project "PRJ-2026-001" (Riser Duct Fabrication) not found. Run the base seed first: npx prisma db seed'
    );
  }

  const admin = await prisma.user.findUnique({ where: { email: "admin@steelflow.com" } });
  if (!admin) {
    throw new Error('User "admin@steelflow.com" not found. Run the base seed first: npx prisma db seed');
  }

  console.log(`Seeding Takeoff data for project ${project.number} — ${project.name}`);

  let sortOrder = await prisma.takeoffDrawing.count({ where: { projectId: project.id } });
  let drawingCount = 0;
  let partCount = 0;

  for (const d of drawings) {
    const existing = await prisma.takeoffDrawing.findFirst({
      where: { projectId: project.id, drawingNumber: d.drawingNumber },
    });
    if (existing) {
      console.log(`  Skipping ${d.drawingNumber} (already seeded)`);
      continue;
    }

    const drawing = await prisma.takeoffDrawing.create({
      data: {
        projectId: project.id,
        drawingNumber: d.drawingNumber,
        title: d.title,
        weightFromDwg: d.weightFromDwg,
        sortOrder: sortOrder++,
      },
    });
    drawingCount++;

    let itemNo = 1;
    for (const p of d.parts) {
      // Excel item labels like "2.1.1" / "3.2" (plate sub-segments) can't
      // fit the schema's Int itemNo, so the original label is kept in the
      // description and itemNo is a sequential integer within the drawing.
      const isPlainInt = /^\d+$/.test(p.itemLabel);
      const description = isPlainInt ? p.description : `${p.description} [item ${p.itemLabel}]`;

      await prisma.takeoffPart.create({
        data: {
          drawingId: drawing.id,
          itemNo: isPlainInt ? parseInt(p.itemLabel, 10) : itemNo,
          description,
          extWidth: p.extWidth,
          extLength: p.extLength,
          intWidth: p.intWidth,
          intLength: p.intLength,
          qty: p.qty,
          thicknessMm: p.thicknessMm,
          extUnitArea: p.extUnitArea ?? 0,
          intUnitArea: p.intUnitArea ?? 0,
          totalUnitArea: p.totalUnitArea ?? 0,
          totalArea: p.totalArea ?? 0,
          volume: p.volume ?? 0,
          weightKg: p.weightKg,
          // Sheet has no painting-side data — default to 2 sides (both
          // faces), which for paintSides=2 means paintAreaSqm == totalArea.
          paintSides: 2,
          paintAreaSqm: p.totalArea ?? 0,
          // All rows in this sheet are duct wall segments (ext + int as two
          // separate surfaces) — the original ADD convention.
          areaMode: "ADD",
        },
      });
      itemNo++;
      partCount++;
    }

    await prisma.activityLog.create({
      data: {
        userId: admin.id,
        action: "CREATE",
        entity: "TAKEOFF_DRAWING",
        entityId: drawing.id,
        detail: `${drawing.drawingNumber} — ${drawing.title} (seeded from Excel, ${d.parts.length} parts)`,
      },
    });
  }

  console.log(`Done. Created ${drawingCount} drawings and ${partCount} parts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
