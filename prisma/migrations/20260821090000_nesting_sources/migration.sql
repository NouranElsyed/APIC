-- Nesting Sources (Phase 1b — automatic part collection) — purely
-- additive. Nothing in Standard Calculations, TakeoffPart, PartDxf,
-- NestingJob, or NestingJobItem is altered, dropped, or renamed.
CREATE TABLE IF NOT EXISTS "nesting_sources" (
  "id" TEXT NOT NULL,
  "material" TEXT NOT NULL,
  "thicknessMm" DOUBLE PRECISION NOT NULL,
  "widthMm" DOUBLE PRECISION NOT NULL,
  "lengthMm" DOUBLE PRECISION NOT NULL,
  "availableQty" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nestingJobId" TEXT NOT NULL,
  CONSTRAINT "nesting_sources_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "nesting_sources" ADD CONSTRAINT "nesting_sources_nestingJobId_fkey"
    FOREIGN KEY ("nestingJobId") REFERENCES "nesting_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
