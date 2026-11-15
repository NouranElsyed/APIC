-- Link between a takeoff part and the part of the project's nesting workspace it came from.
ALTER TABLE "takeoff_parts" ADD COLUMN "nestKind" TEXT;
ALTER TABLE "takeoff_parts" ADD COLUMN "nestPartId" INTEGER;
ALTER TABLE "takeoff_parts" ADD COLUMN "nestSyncedQty" INTEGER;
ALTER TABLE "takeoff_parts" ADD COLUMN "nestSyncedAt" TIMESTAMP(3);
CREATE INDEX "takeoff_parts_nestKind_nestPartId_idx" ON "takeoff_parts"("nestKind", "nestPartId");

-- Version of a nesting workspace: every save (browser autosave or server-side sync) bumps it, so a stale
-- save can be refused instead of silently overwriting a newer one.
ALTER TABLE "nesting_workspaces" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
