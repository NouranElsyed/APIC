// One-off for an EXISTING database: replaces the old demo accounts with the four engineers.
//   npm run db:replace-users
//
// - creates / updates Nouran Elsayed, Reham Elsayed, Mohamed Taher, Nada Mohamed (role ENGINEER)
// - everything the old demo users created (projects, documents, notices ...) is handed over to
//   Nouran Elsayed first, because those links block deleting a user — no project or file is lost
// - then the old demo accounts are deleted (their login-activity rows go with them)
// Safe to run twice.
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const PASSWORD = "password123";

const ENGINEERS = [
  { name: "Nouran Elsayed", email: "nouran.elsayed@steelflow.com" },
  { name: "Reham Elsayed", email: "reham.elsayed@steelflow.com" },
  { name: "Mohamed Taher", email: "mohamed.taher@steelflow.com" },
  { name: "Nada Mohamed", email: "nada.mohamed@steelflow.com" },
];

const OLD_DEMO_EMAILS = [
  "admin@steelflow.com", "manager@steelflow.com", "engineer@steelflow.com", "viewer@steelflow.com",
  "youssef.adel@steelflow.com", "nour.ibrahim@steelflow.com", "hossam.zaki@steelflow.com", "dina.mostafa@steelflow.com",
];

async function main() {
  const password = await bcrypt.hash(PASSWORD, 10);
  const created = [];
  for (const e of ENGINEERS) {
    created.push(
      await prisma.user.upsert({
        where: { email: e.email },
        update: { name: e.name, role: Role.ENGINEER, department: "Engineering", active: true },
        create: { ...e, role: Role.ENGINEER, department: "Engineering", password, active: true },
      }),
    );
  }
  const heir = created[0];

  const old = await prisma.user.findMany({ where: { email: { in: OLD_DEMO_EMAILS } }, select: { id: true, email: true } });
  const ids = old.map((u) => u.id);
  if (ids.length) {
    await prisma.$transaction([
      prisma.project.updateMany({ where: { createdById: { in: ids } }, data: { createdById: heir.id } }),
      prisma.document.updateMany({ where: { uploadedById: { in: ids } }, data: { uploadedById: heir.id } }),
      prisma.scopeItem.updateMany({ where: { createdById: { in: ids } }, data: { createdById: heir.id } }),
      prisma.notice.updateMany({ where: { createdById: { in: ids } }, data: { createdById: heir.id } }),
      prisma.meetingMinute.updateMany({ where: { createdById: { in: ids } }, data: { createdById: heir.id } }),
      prisma.partDxf.updateMany({ where: { uploadedById: { in: ids } }, data: { uploadedById: heir.id } }),
      prisma.nestingJob.updateMany({ where: { createdById: { in: ids } }, data: { createdById: heir.id } }),
      prisma.nestingRun.updateMany({ where: { createdById: { in: ids } }, data: { createdById: heir.id } }),
      prisma.user.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }

  console.log(`Engineers ready: ${created.map((u) => u.email).join(", ")}`);
  console.log(`Removed ${ids.length} old demo account(s)${ids.length ? `; their records now belong to ${heir.name}` : ""}.`);
  console.log(`Password for the engineers: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
