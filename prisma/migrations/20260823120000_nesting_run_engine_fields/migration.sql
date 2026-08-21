-- AlterTable
ALTER TABLE "nesting_runs"
  ADD COLUMN "algorithmName" TEXT,
  ADD COLUMN "algorithmVersion" TEXT,
  ADD COLUMN "configJson" JSONB,
  ADD COLUMN "totalPartsRequired" INTEGER,
  ADD COLUMN "totalPartsPlaced" INTEGER,
  ADD COLUMN "totalPartsUnplaced" INTEGER,
  ADD COLUMN "unplacedPartsJson" JSONB;
