-- Phase 2C: distinguish assisted-nesting sessions from ordinary automatic
-- runs, and track the provenance (manual / pattern-generated / optimizer)
-- and lock state of each individual placement within one. Both new
-- columns are NOT NULL with a default so every existing row backfills
-- safely and Standard/automatic nesting behavior is unchanged (mode
-- defaults to 'AUTO', origin defaults to 'AUTO', isLocked defaults to
-- false).

ALTER TABLE "nesting_runs"
  ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'AUTO';

ALTER TABLE "nesting_placements"
  ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false;
