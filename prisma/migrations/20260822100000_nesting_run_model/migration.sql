-- Phase 2A — additive, backward-compatible migration.
-- Adds the persistence foundation for future nesting runs/sheets/placements.
-- Does NOT touch existing tables/data (takeoff_parts, nesting_jobs,
-- nesting_sources, nesting_job_items, users, etc.). No nesting algorithm
-- runs as a result of this migration; NestingRun rows are only ever
-- created by a future engine, not by anything shipped in this phase.

-- CreateEnum
CREATE TYPE "NestingRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "nesting_runs" (
    "id" TEXT NOT NULL,
    "status" "NestingRunStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "totalSheets" INTEGER,
    "totalUsedAreaSqm" DOUBLE PRECISION,
    "totalScrapAreaSqm" DOUBLE PRECISION,
    "overallUtilizationPercent" DOUBLE PRECISION,
    "nestingJobId" TEXT NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "nesting_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nesting_sheets" (
    "id" TEXT NOT NULL,
    "sheetNumber" INTEGER NOT NULL,
    "material" TEXT NOT NULL,
    "thicknessMm" DOUBLE PRECISION NOT NULL,
    "widthMm" DOUBLE PRECISION NOT NULL,
    "lengthMm" DOUBLE PRECISION NOT NULL,
    "usedAreaSqm" DOUBLE PRECISION,
    "scrapAreaSqm" DOUBLE PRECISION,
    "utilizationPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nestingRunId" TEXT NOT NULL,
    "sourceSheetId" TEXT,

    CONSTRAINT "nesting_sheets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nesting_placements" (
    "id" TEXT NOT NULL,
    "instanceNumber" INTEGER NOT NULL,
    "xMm" DOUBLE PRECISION NOT NULL,
    "yMm" DOUBLE PRECISION NOT NULL,
    "rotationDeg" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nestingSheetId" TEXT NOT NULL,
    "nestingRunId" TEXT NOT NULL,
    "takeoffPartId" TEXT NOT NULL,

    CONSTRAINT "nesting_placements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nesting_runs_nestingJobId_idx" ON "nesting_runs"("nestingJobId");

-- CreateIndex
CREATE INDEX "nesting_runs_status_idx" ON "nesting_runs"("status");

-- CreateIndex
CREATE INDEX "nesting_sheets_nestingRunId_idx" ON "nesting_sheets"("nestingRunId");

-- CreateIndex
CREATE UNIQUE INDEX "nesting_sheets_nestingRunId_sheetNumber_key" ON "nesting_sheets"("nestingRunId", "sheetNumber");

-- CreateIndex
CREATE INDEX "nesting_placements_nestingSheetId_idx" ON "nesting_placements"("nestingSheetId");

-- CreateIndex
CREATE INDEX "nesting_placements_takeoffPartId_idx" ON "nesting_placements"("takeoffPartId");

-- CreateIndex
CREATE UNIQUE INDEX "nesting_placements_nestingRunId_takeoffPartId_instanceNumber_key" ON "nesting_placements"("nestingRunId", "takeoffPartId", "instanceNumber");

-- AddForeignKey
ALTER TABLE "nesting_runs" ADD CONSTRAINT "nesting_runs_nestingJobId_fkey" FOREIGN KEY ("nestingJobId") REFERENCES "nesting_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nesting_runs" ADD CONSTRAINT "nesting_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nesting_sheets" ADD CONSTRAINT "nesting_sheets_nestingRunId_fkey" FOREIGN KEY ("nestingRunId") REFERENCES "nesting_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nesting_sheets" ADD CONSTRAINT "nesting_sheets_sourceSheetId_fkey" FOREIGN KEY ("sourceSheetId") REFERENCES "nesting_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nesting_placements" ADD CONSTRAINT "nesting_placements_nestingSheetId_fkey" FOREIGN KEY ("nestingSheetId") REFERENCES "nesting_sheets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nesting_placements" ADD CONSTRAINT "nesting_placements_nestingRunId_fkey" FOREIGN KEY ("nestingRunId") REFERENCES "nesting_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nesting_placements" ADD CONSTRAINT "nesting_placements_takeoffPartId_fkey" FOREIGN KEY ("takeoffPartId") REFERENCES "takeoff_parts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
