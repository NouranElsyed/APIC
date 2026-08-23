-- Phase 2B: availableQty becomes a hard limit the engine enforces, a
-- PARTIAL run status distinct from COMPLETED (PROJECT.md Phase 2B §16 "No
-- fake success"), and a per-group source shortage report.

ALTER TYPE "NestingRunStatus" ADD VALUE IF NOT EXISTS 'PARTIAL';

ALTER TABLE "nesting_runs"
  ADD COLUMN "sourceShortageJson" JSONB;
