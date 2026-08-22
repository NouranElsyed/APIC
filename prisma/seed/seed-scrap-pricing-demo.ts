import { PrismaClient, PartType, PartSide, NestingJobStatus, NestingRunStatus } from "@prisma/client";
import { DRAWINGS, GROUPS } from "./riser-bom-data";

// ----------------------------------------------------------------------------
// Demo data matching "calculate_area_formatted.xlsx" (Riser Duct Fabrication
// Drg / pricing sheets) so Scrap & Material Pricing can be calculated and
// exported against a real project instead of an empty one.
//
// Unlike the first version of this script, the Part List here is the REAL
// per-item BOM (97 parts across 8 real drawings, parsed straight out of the
// workbook) — not one fabricated row per material group. The Nesting/Scrap
// Calculation groups are derived bottom-up from that same real BOM (assuming
// 6m-long stock bars and 6m x 1.5m plate sheets), so every number on every
// sheet traces back to an actual part.
//
// Run with: npx tsx prisma/seed/seed-scrap-pricing-demo.ts
// (safe to re-run: it wipes and recreates this one demo project's nesting
// data before inserting, so it never duplicates)
// ----------------------------------------------------------------------------

const prisma = new PrismaClient();

const PROJECT_NUMBER = "PRJ-2026-001"; // "Riser Duct Fabrication" from the main seed.ts
const DENSITY = 7.85; // kg / (m2 * mm), matches STEEL_DENSITY_KG_PER_M2_MM

function normalize(desc: string) {
  return desc.trim().toUpperCase().replace(/\s+/g, " ");
}

function partTypeFor(desc: string) {
  return normalize(desc).startsWith("PL") ? PartType.PLATE : PartType.HOT_ROLLED;
}

function rectGeometry(widthMm: number, lengthMm: number) {
  return {
    outer: [
      { x: 0, y: 0 },
      { x: widthMm, y: 0 },
      { x: widthMm, y: lengthMm },
      { x: 0, y: lengthMm },
    ],
    holes: [],
  };
}

async function main() {
  const project = await prisma.project.findUnique({ where: { number: PROJECT_NUMBER } });
  if (!project) {
    throw new Error(`${PROJECT_NUMBER} not found — run "npx prisma db seed" first so the base project exists.`);
  }
  const engineer = await prisma.user.findFirst({ where: { role: "ENGINEER" } });
  if (!engineer) throw new Error("No ENGINEER user found — run the main seed first.");

  console.log(`Seeding real BOM (${DRAWINGS.reduce((s, d) => s + d.items.length, 0)} parts / ${DRAWINGS.length} drawings) into ${project.number} — ${project.name}`);

  // Wipe this project's existing nesting/takeoff data so the script is
  // re-runnable without duplicating rows.
  await prisma.nestingJob.deleteMany({ where: { projectId: project.id } });
  await prisma.takeoffDrawing.deleteMany({ where: { projectId: project.id } });

  const job = await prisma.nestingJob.create({
    data: {
      projectId: project.id,
      name: "Riser Duct Fabrication - Nesting",
      status: NestingJobStatus.READY,
      createdById: engineer.id,
    },
  });

  // One NestingSource per material+thickness group (the buy-stock sheet/bar
  // size assumed for that group), created up front so every part placement
  // below can reference the right source.
  const sourceByGroup = new Map<string, string>();
  for (const [key, g] of Object.entries(GROUPS)) {
    const source = await prisma.nestingSource.create({
      data: {
        nestingJobId: job.id,
        material: "Steel",
        thicknessMm: g.thicknessMm,
        widthMm: g.widthM * 1000,
        lengthMm: g.lengthM * 1000,
        availableQty: null,
      },
    });
    sourceByGroup.set(key, source.id);
  }

  const nestingRunId = (
    await prisma.nestingRun.create({
      data: {
        nestingJobId: job.id,
        status: NestingRunStatus.COMPLETED,
        algorithmName: "SteelFlow Nesting Engine",
        algorithmVersion: "1.0",
        createdById: engineer.id,
        startedAt: new Date(),
        completedAt: new Date(),
        totalSheets: Object.values(GROUPS).reduce((s, g) => s + g.buyQty, 0),
        totalUsedAreaSqm: Object.values(GROUPS).reduce((s, g) => s + g.usedAreaSqm, 0),
        totalPartsRequired: DRAWINGS.reduce((s, d) => s + d.items.length, 0),
        totalPartsPlaced: DRAWINGS.reduce((s, d) => s + d.items.length, 0),
        totalPartsUnplaced: 0,
        unplacedPartsJson: [],
        sourceRequirementJson: Object.entries(GROUPS).map(([key, g]) => ({
          sourceSheetId: sourceByGroup.get(key) ?? null,
          material: "Steel",
          thicknessMm: g.thicknessMm,
          widthMm: g.widthM * 1000,
          lengthMm: g.lengthM * 1000,
          requiredQty: g.buyQty,
        })),
      },
    })
  ).id;

  // One NestingSheet per group, representing the aggregate cut sheet(s) for
  // that material+thickness (real per-part nesting layout is out of scope
  // for this demo — the Part List and quantities are what's real here).
  const sheetByGroup = new Map<string, string>();
  for (const [key, g] of Object.entries(GROUPS)) {
    const buyAreaSqm = g.buyQty * g.widthM * g.lengthM;
    const sheet = await prisma.nestingSheet.create({
      data: {
        nestingRunId,
        sourceSheetId: sourceByGroup.get(key)!,
        sheetNumber: sheetByGroup.size + 1,
        material: "Steel",
        thicknessMm: g.thicknessMm,
        widthMm: g.widthM * 1000,
        lengthMm: g.lengthM * 1000,
        usedAreaSqm: g.usedAreaSqm,
        scrapAreaSqm: Math.max(0, buyAreaSqm - g.usedAreaSqm),
        utilizationPercent: buyAreaSqm > 0 ? (g.usedAreaSqm / buyAreaSqm) * 100 : 0,
      },
    });
    sheetByGroup.set(key, sheet.id);
  }

  // Real per-item BOM: one TakeoffPart (+ placeholder DXF) per actual line,
  // under its actual drawing — this is what the Part List sheet reads from.
  const placementInstance = new Map<string, number>();
  for (const d of DRAWINGS) {
    const drawing = await prisma.takeoffDrawing.create({
      data: { projectId: project.id, drawingNumber: d.drawingNumber, title: d.title, sortOrder: 0 },
    });

    let seq = 0;
    for (const it of d.items) {
      seq += 1;
      const key = normalize(it.description);
      const group = GROUPS[key];
      const groupSourceId = sourceByGroup.get(key);
      const groupSheetId = sheetByGroup.get(key);
      if (!group || !groupSourceId || !groupSheetId) {
        console.warn(`No group for "${it.description}" (drawing ${d.drawingNumber}, item ${it.itemNo}) — skipping.`);
        continue;
      }

      const widthMm = it.widthMm ?? group.widthM * 1000;
      const lengthMm = (it.lengthM ?? group.lengthM) * 1000;
      const totalAreaSqm = it.unitAreaSqm * it.qty;
      // Sub-item codes like "2.1.1" aren't valid integer itemNo's — keep the
      // sequential position as itemNo and preserve the original code in the
      // description so it's still traceable back to the source drawing.
      const description = /^\d+$/.test(it.itemNo) ? it.description : `${it.description} (item ${it.itemNo})`;

      const part = await prisma.takeoffPart.create({
        data: {
          drawingId: drawing.id,
          itemNo: seq,
          description,
          material: "Steel",
          partType: partTypeFor(it.description),
          side: PartSide.EXTERNAL,
          qty: Math.max(1, Math.round(it.qty)),
          thicknessMm: it.thicknessMm,
          geometry: { width: widthMm / 1000, length: lengthMm / 1000 },
          areaFormula: "width*length",
          totalArea: totalAreaSqm,
          volume: totalAreaSqm * it.thicknessMm,
          weightKg: totalAreaSqm * it.thicknessMm * DENSITY,
          paintAreaSqm: totalAreaSqm * 2,
          dxf: {
            create: {
              fileName: `${d.drawingNumber}_item${it.itemNo}.dxf`,
              filePath: "/uploads/demo-placeholder.dxf",
              valid: true,
              unitsDetected: "mm",
              areaSqm: it.unitAreaSqm,
              bboxWidthMm: widthMm,
              bboxHeightMm: lengthMm,
              outerContourCount: 1,
              holeCount: 0,
              geometryJson: rectGeometry(widthMm, lengthMm),
              uploadedBy: { connect: { id: engineer.id } },
            },
          },
        },
      });

      const instance = (placementInstance.get(groupSheetId) ?? 0) + 1;
      placementInstance.set(groupSheetId, instance);
      await prisma.nestingPlacement.create({
        data: {
          nestingRunId,
          nestingSheetId: groupSheetId,
          takeoffPartId: part.id,
          instanceNumber: instance,
          xMm: 0,
          yMm: 0,
          rotationDeg: 0,
        },
      });
    }
  }

  console.log(`Done — ${DRAWINGS.length} drawings, ${Object.keys(GROUPS).length} material groups, nesting run ${nestingRunId}.`);
  console.log(`Open the project in the app -> DXF Nesting (job "${job.name}") -> Scrap & Material to calculate/export.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
