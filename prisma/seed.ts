import { PrismaClient, Role, ProjectStatus, DocumentCategory } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const DEMO_PASSWORD = "password123";

async function main() {
  console.log("Seeding database...");

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  // --- Users -----------------------------------------------------------
  const usersData: { name: string; email: string; role: Role; department: string }[] = [
    { name: "Ahmed Salah", email: "admin@steelflow.com", role: Role.ADMIN, department: "Management" },
    { name: "Mona Farouk", email: "manager@steelflow.com", role: Role.MANAGER, department: "Operations" },
    { name: "Karim El-Sayed", email: "engineer@steelflow.com", role: Role.ENGINEER, department: "Engineering" },
    { name: "Laila Hassan", email: "viewer@steelflow.com", role: Role.VIEWER, department: "Finance" },
    { name: "Youssef Adel", email: "youssef.adel@steelflow.com", role: Role.ENGINEER, department: "Engineering" },
    { name: "Nour Ibrahim", email: "nour.ibrahim@steelflow.com", role: Role.MANAGER, department: "Projects" },
    { name: "Hossam Zaki", email: "hossam.zaki@steelflow.com", role: Role.ENGINEER, department: "Fabrication" },
    { name: "Dina Mostafa", email: "dina.mostafa@steelflow.com", role: Role.VIEWER, department: "Quality" },
  ];

  const users = [];
  for (const u of usersData) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, password: passwordHash, active: true },
    });
    users.push(user);
  }
  const admin = users[0];
  console.log(`Created ${users.length} users`);

  // --- Customers ---------------------------------------------------------
  const customersData = [
    { code: "CUST-001", name: "Nile Steel Works", contact: "Tarek Mahmoud", email: "tarek@nilesteel.com", phone: "+20 100 111 2233", address: "Industrial Zone A, 6th of October City", taxNumber: "EG-100234" },
    { code: "CUST-002", name: "Cairo Fabrication Co.", contact: "Sara Adly", email: "sara@cairofab.com", phone: "+20 101 222 3344", address: "10th of Ramadan Industrial Zone", taxNumber: "EG-100567" },
    { code: "CUST-003", name: "Delta Engineering Group", contact: "Omar Khaled", email: "omar@deltaeng.com", phone: "+20 102 333 4455", address: "Mansoura Industrial Area", taxNumber: "EG-100890" },
    { code: "CUST-004", name: "Alexandria Marine Industries", contact: "Rania Fathy", email: "rania@amimarine.com", phone: "+20 103 444 5566", address: "Alexandria Free Zone", taxNumber: "EG-101123" },
    { code: "CUST-005", name: "Suez Petrochemical Contractors", contact: "Wael Nabil", email: "wael@suezpetro.com", phone: "+20 104 555 6677", address: "Ain Sokhna Industrial Zone", taxNumber: "EG-101456" },
    { code: "CUST-006", name: "Upper Egypt Metal Works", contact: "Heba Sabry", email: "heba@uemetal.com", phone: "+20 105 666 7788", address: "Assiut Industrial District", taxNumber: "EG-101789" },
    { code: "CUST-007", name: "Red Sea Offshore Structures", contact: "Amr Fawzy", email: "amr@redseaoffshore.com", phone: "+20 106 777 8899", address: "Hurghada Port Zone", taxNumber: "EG-102012" },
    { code: "CUST-008", name: "Giza Power Plant Contractors", contact: "Mai Reda", email: "mai@gizapower.com", phone: "+20 107 888 9900", address: "6th of October Power Complex", taxNumber: "EG-102345" },
    { code: "CUST-009", name: "New Capital Infrastructure LLC", contact: "Sherif Anwar", email: "sherif@ncinfra.com", phone: "+20 108 999 0011", address: "New Administrative Capital, R7", taxNumber: "EG-102678" },
    { code: "CUST-010", name: "Aswan Heavy Industries", contact: "Nada Kamel", email: "nada@aswanhi.com", phone: "+20 109 000 1122", address: "Aswan Industrial Zone", taxNumber: "EG-102901" },
  ];

  const customers = [];
  for (const c of customersData) {
    const customer = await prisma.customer.upsert({ where: { code: c.code }, update: {}, create: c });
    customers.push(customer);
  }
  console.log(`Created ${customers.length} customers`);

  // --- Projects ------------------------------------------------------
  const projectNames = [
    "Riser Duct Fabrication", "Structural Steel Frame - Warehouse B", "Pipe Rack Support System",
    "Pressure Vessel Skid Assembly", "Platform Grating & Handrails", "Storage Tank Foundation Steelwork",
    "Conveyor Support Structure", "Flare Stack Fabrication", "Cooling Tower Steel Structure",
    "Offshore Jacket Structure - Phase 1", "HVAC Ducting System Retrofit", "Access Stairs & Walkways",
    "Pipe Bridge Crossing Structure", "Equipment Skid Base Frames", "Silo Support Structure",
    "Boiler House Steel Frame", "Loading Bay Canopy Structure", "Substation Steel Structure",
    "Marine Jetty Steel Fenders", "Process Module Steel Frame",
  ];
  const statuses: ProjectStatus[] = [ProjectStatus.DRAFT, ProjectStatus.ACTIVE, ProjectStatus.ON_HOLD, ProjectStatus.COMPLETED, ProjectStatus.ARCHIVED];

  const projects = [];
  for (let i = 0; i < projectNames.length; i++) {
    const customer = customers[i % customers.length];
    const status = statuses[i % statuses.length];
    const createdByUser = users[i % users.length];
    const start = new Date(2026, i % 6, 1 + (i % 20));
    const end = new Date(start.getTime() + 1000 * 60 * 60 * 24 * (60 + (i % 5) * 15));

    const project = await prisma.project.upsert({
      where: { number: `PRJ-2026-${String(i + 1).padStart(3, "0")}` },
      update: {},
      create: {
        number: `PRJ-2026-${String(i + 1).padStart(3, "0")}`,
        name: projectNames[i],
        customerId: customer.id,
        description: `${projectNames[i]} for ${customer.name}. Includes detailed engineering, fabrication and site erection support.`,
        status,
        revision: `Rev. 0${(i % 3) + 1}`,
        startDate: start,
        endDate: end,
        createdById: createdByUser.id,
      },
    });
    projects.push(project);

    await prisma.activityLog.create({
      data: { userId: createdByUser.id, action: "CREATE", entity: "PROJECT", entityId: project.id, detail: project.number, timestamp: start },
    });
  }
  console.log(`Created ${projects.length} projects`);

  // --- Documents -------------------------------------------------------
  const categories: DocumentCategory[] = [
    DocumentCategory.DRAWING, DocumentCategory.SPECIFICATION, DocumentCategory.CONTRACT,
    DocumentCategory.PURCHASE_ORDER, DocumentCategory.TECHNICAL_DOCUMENT, DocumentCategory.OTHER,
  ];
  const docTitlesByCategory: Record<string, string[]> = {
    DRAWING: ["General Arrangement Drawing", "Fabrication Detail Drawing", "As-Built Drawing"],
    SPECIFICATION: ["Material Specification", "Welding Procedure Specification", "Coating Specification"],
    CONTRACT: ["Supply Contract", "Service Agreement", "Subcontract Agreement"],
    PURCHASE_ORDER: ["Steel Plate Purchase Order", "Bolts & Fasteners PO", "Paint & Coating PO"],
    TECHNICAL_DOCUMENT: ["Method Statement", "Inspection & Test Plan", "Load Calculation Report"],
    OTHER: ["Site Photos", "Meeting Minutes", "Correspondence"],
  };

  let docCount = 0;
  for (let i = 0; i < 30; i++) {
    const project = projects[i % projects.length];
    const category = categories[i % categories.length];
    const titleOptions = docTitlesByCategory[category];
    const title = titleOptions[i % titleOptions.length];
    const uploadedBy = users[(i + 1) % users.length];
    const uploadDate = new Date(2026, i % 6, 2 + (i % 25));

    await prisma.document.create({
      data: {
        title: `${title} — ${project.number}`,
        category,
        projectId: project.id,
        revision: `Rev. 0${(i % 3) + 1}`,
        fileName: `${title.toLowerCase().replace(/\s+/g, "-")}.pdf`,
        filePath: "/uploads/sample-placeholder.pdf",
        fileSize: 120_000 + i * 3500,
        uploadedById: uploadedBy.id,
        uploadDate,
      },
    });
    docCount++;

    await prisma.activityLog.create({
      data: { userId: uploadedBy.id, action: "CREATE", entity: "DOCUMENT", detail: title, timestamp: uploadDate },
    });
  }
  console.log(`Created ${docCount} documents`);

  // --- Company settings --------------------------------------------------
  await prisma.companySettings.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      name: "SteelFlow Engineering Co.",
      address: "6th of October Industrial Zone, Giza, Egypt",
      phone: "+20 2 3812 4455",
      email: "info@steelflow-eg.com",
      timezone: "Africa/Cairo",
      language: "en",
      dateFormat: "DD/MM/YYYY",
      currency: "EGP",
      theme: "light",
      defaultRevisionFormat: "Rev. 00",
      autoSave: true,
    },
  });

  // --- Project status config -----------------------------------------
  const statusConfig = [
    { status: ProjectStatus.DRAFT, label: "Draft", color: "gray", sortOrder: 0, isDefault: true },
    { status: ProjectStatus.ACTIVE, label: "Active", color: "green", sortOrder: 1, isDefault: false },
    { status: ProjectStatus.ON_HOLD, label: "On Hold", color: "amber", sortOrder: 2, isDefault: false },
    { status: ProjectStatus.COMPLETED, label: "Completed", color: "blue", sortOrder: 3, isDefault: false },
    { status: ProjectStatus.ARCHIVED, label: "Archived", color: "slate", sortOrder: 4, isDefault: false },
  ];
  for (const s of statusConfig) {
    await prisma.projectStatusConfig.upsert({ where: { status: s.status }, update: s, create: s });
  }

  // Login activity for admin so dashboard isn't empty
  await prisma.activityLog.create({ data: { userId: admin.id, action: "LOGIN", entity: "USER", entityId: admin.id } });

  console.log("Seeding complete.");
  console.log("\nDemo accounts (password: password123):");
  usersData.slice(0, 4).forEach((u) => console.log(`  ${u.role.padEnd(10)} ${u.email}`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
