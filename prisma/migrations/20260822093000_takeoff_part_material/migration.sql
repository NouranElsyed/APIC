-- Additive, backward-compatible migration.
-- Adds a nullable per-part `material` column to takeoff_parts.
-- Existing rows are unaffected (material = NULL until set); NestingJob's
-- legacy `material` / `thicknessMm` columns are untouched.
ALTER TABLE "takeoff_parts" ADD COLUMN "material" TEXT;
