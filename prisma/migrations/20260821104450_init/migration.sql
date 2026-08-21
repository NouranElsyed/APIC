-- AlterTable
ALTER TABLE "takeoff_parts" ALTER COLUMN "partType" DROP DEFAULT,
ALTER COLUMN "geometry" DROP DEFAULT;

-- RenameIndex
ALTER INDEX "nesting_placements_nestingRunId_takeoffPartId_instanceNumber_ke" RENAME TO "nesting_placements_nestingRunId_takeoffPartId_instanceNumbe_key";
