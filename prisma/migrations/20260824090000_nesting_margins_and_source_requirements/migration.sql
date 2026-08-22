-- Phase 2: per-side sheet margins, source requirement report, and making
-- NestingSource.availableQty informational-only (nullable).

ALTER TABLE "nesting_runs"
  ADD COLUMN "partGapMm" DOUBLE PRECISION,
  ADD COLUMN "marginLeftMm" DOUBLE PRECISION,
  ADD COLUMN "marginRightMm" DOUBLE PRECISION,
  ADD COLUMN "marginTopMm" DOUBLE PRECISION,
  ADD COLUMN "marginBottomMm" DOUBLE PRECISION,
  ADD COLUMN "sourceRequirementJson" JSONB;

ALTER TABLE "nesting_sources"
  ALTER COLUMN "availableQty" DROP NOT NULL;
