-- DXF Nesting (Phase 1) — purely additive. Nothing in the existing
-- Standard Calculations tables (takeoff_drawings / takeoff_parts) is
-- altered, dropped, or renamed. Existing rows are unaffected: PartDxf is
-- optional (0..1), and nesting_job_items only ever references existing
-- takeoff_parts rows, never duplicates them.

DO $$ BEGIN
  CREATE TYPE "NestingJobStatus" AS ENUM ('DRAFT', 'READY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "part_dxf_files" (
  "id" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "filePath" TEXT NOT NULL,
  "fileSize" INTEGER,
  "valid" BOOLEAN NOT NULL DEFAULT false,
  "errorMessage" TEXT,
  "unitsDetected" TEXT,
  "areaSqm" DOUBLE PRECISION,
  "bboxWidthMm" DOUBLE PRECISION,
  "bboxHeightMm" DOUBLE PRECISION,
  "outerContourCount" INTEGER,
  "holeCount" INTEGER DEFAULT 0,
  "geometryJson" JSONB,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "takeoffPartId" TEXT NOT NULL,
  "uploadedById" TEXT NOT NULL,
  CONSTRAINT "part_dxf_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "part_dxf_files_takeoffPartId_key" ON "part_dxf_files"("takeoffPartId");

DO $$ BEGIN
  ALTER TABLE "part_dxf_files" ADD CONSTRAINT "part_dxf_files_takeoffPartId_fkey"
    FOREIGN KEY ("takeoffPartId") REFERENCES "takeoff_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "part_dxf_files" ADD CONSTRAINT "part_dxf_files_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "nesting_jobs" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "material" TEXT,
  "thicknessMm" DOUBLE PRECISION,
  "status" "NestingJobStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "nesting_jobs_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "nesting_jobs" ADD CONSTRAINT "nesting_jobs_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "nesting_jobs" ADD CONSTRAINT "nesting_jobs_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "nesting_job_items" (
  "id" TEXT NOT NULL,
  "qtyOverride" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nestingJobId" TEXT NOT NULL,
  "takeoffPartId" TEXT NOT NULL,
  CONSTRAINT "nesting_job_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "nesting_job_items_nestingJobId_takeoffPartId_key"
  ON "nesting_job_items"("nestingJobId", "takeoffPartId");

DO $$ BEGIN
  ALTER TABLE "nesting_job_items" ADD CONSTRAINT "nesting_job_items_nestingJobId_fkey"
    FOREIGN KEY ("nestingJobId") REFERENCES "nesting_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "nesting_job_items" ADD CONSTRAINT "nesting_job_items_takeoffPartId_fkey"
    FOREIGN KEY ("takeoffPartId") REFERENCES "takeoff_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
