-- CreateEnum
CREATE TYPE "TakeoffAreaMode" AS ENUM ('ADD', 'SUBTRACT');

-- AlterTable
ALTER TABLE "takeoff_parts" ADD COLUMN     "areaMode" "TakeoffAreaMode" NOT NULL DEFAULT 'ADD';
