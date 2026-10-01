// Deletes every project EXCEPT the one you keep (default: PRJ-2026-020).
// Everything attached to a deleted project (documents, takeoff drawings, scope items,
// notices, meeting minutes, nesting jobs ...) is removed with it (onDelete: Cascade).
// Customers and users are NOT touched.
//
// Safe by default: without --yes it only LISTS what would be deleted.
//
//   npx tsx prisma/seed/keep-one-project.ts                      # preview only
//   npx tsx prisma/seed/keep-one-project.ts --yes                # really delete
//   npx tsx prisma/seed/keep-one-project.ts --keep=PRJ-2026-015 --yes
//
// Don't run `npm run db:seed` afterwards: it re-creates PRJ-2026-001 ... 020.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const keepArg = process.argv.find((a) => a.startsWith("--keep="));
  const keep = keepArg ? keepArg.slice("--keep=".length) : "PRJ-2026-020";
  const really = process.argv.includes("--yes");

  const kept = await prisma.project.findUnique({ where: { number: keep } });
  if (!kept) {
    console.error(`Project "${keep}" not found - nothing deleted.`);
    process.exitCode = 1;
    return;
  }

  const doomed = await prisma.project.findMany({
    where: { number: { not: keep } },
    select: { id: true, number: true, name: true },
    orderBy: { number: "asc" },
  });

  console.log(`Keeping: ${kept.number} - ${kept.name}`);
  console.log(`To delete (${doomed.length}):`);
  for (const p of doomed) console.log(`  ${p.number} - ${p.name}`);

  if (!really) {
    console.log("\nPreview only. Run again with --yes to delete them.");
    return;
  }

  const ids = doomed.map((p) => p.id);
  await prisma.$transaction([
    prisma.activityLog.deleteMany({ where: { entity: "PROJECT", entityId: { in: ids } } }),
    prisma.project.deleteMany({ where: { id: { in: ids } } }),
  ]);
  console.log(`\nDeleted ${ids.length} projects. Kept ${kept.number}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
