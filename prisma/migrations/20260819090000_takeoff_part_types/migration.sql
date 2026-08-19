-- Rebuild TakeoffPart around explicit part types instead of the old
-- ext/int width-length + area-mode model.
-- New enums
DO $$ BEGIN
  CREATE TYPE "PartType" AS ENUM ('PLATE', 'HOT_ROLLED', 'CONE', 'PIPE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "PartSide" AS ENUM ('INTERNAL', 'EXTERNAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- New columns. Existing rows (all created under the old plate-style model)
-- default to PLATE / EXTERNAL / an empty geometry object — they will show
-- up with a "—" formula until re-saved from the UI.
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "partType" "PartType" NOT NULL DEFAULT 'PLATE';
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "side" "PartSide" NOT NULL DEFAULT 'EXTERNAL';
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "geometry" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "takeoff_parts" ADD COLUMN IF NOT EXISTS "areaFormula" TEXT;
-- thicknessMm is no longer required (HOT_ROLLED parts don't use it)
ALTER TABLE "takeoff_parts" ALTER COLUMN "thicknessMm" DROP NOT NULL;
-- Drop the old geometry model
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "extWidth";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "extLength";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "intWidth";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "intLength";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "extUnitArea";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "intUnitArea";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "totalUnitArea";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "customFormula";
ALTER TABLE "takeoff_parts" DROP COLUMN IF EXISTS "areaMode";
DROP TYPE IF EXISTS "TakeoffAreaMode";
