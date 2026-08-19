-- Add CUSTOM area mode
ALTER TYPE "TakeoffAreaMode" ADD VALUE IF NOT EXISTS 'CUSTOM';

-- Per-row custom formula override (used when areaMode = CUSTOM)
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "customFormula" TEXT;

-- Scrap tracking
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "buyWeightKg" DOUBLE PRECISION;
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "scrapKg" DOUBLE PRECISION;
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "scrapPct" DOUBLE PRECISION;
