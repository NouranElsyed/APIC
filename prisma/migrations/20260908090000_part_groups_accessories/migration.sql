-- BOQ assemblies (part groups) and the ACCESSORY part type. Additive only: existing rows are untouched.
ALTER TYPE "PartType" ADD VALUE IF NOT EXISTS 'ACCESSORY';

CREATE TABLE "part_groups" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dwgNo" TEXT,
  "qty" INTEGER NOT NULL DEFAULT 1,
  "remark" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "parentId" TEXT,
  CONSTRAINT "part_groups_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "part_groups_projectId_code_key" ON "part_groups"("projectId", "code");
CREATE INDEX "part_groups_projectId_sortOrder_idx" ON "part_groups"("projectId", "sortOrder");
ALTER TABLE "part_groups" ADD CONSTRAINT "part_groups_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "part_groups" ADD CONSTRAINT "part_groups_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "part_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "takeoff_parts" ADD COLUMN "groupId" TEXT;
ALTER TABLE "takeoff_parts" ADD COLUMN "posNo" TEXT;
ALTER TABLE "takeoff_parts" ADD COLUMN "qtyPerAssembly" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "takeoff_parts" ADD COLUMN "remark" TEXT;
CREATE INDEX "takeoff_parts_groupId_idx" ON "takeoff_parts"("groupId");
ALTER TABLE "takeoff_parts" ADD CONSTRAINT "takeoff_parts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "part_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;
