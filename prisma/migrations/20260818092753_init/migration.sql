/*
  Warnings:

  - The values [DRAFT,ACTIVE] on the enum `ProjectStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('TENDERING', 'EXECUTION');

-- AlterEnum
BEGIN;
CREATE TYPE "ProjectStatus_new" AS ENUM ('UNDER_STUDY', 'SUBMITTED', 'APOLOGIZED', 'CANCELLED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');
ALTER TABLE "projects" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "projects" ALTER COLUMN "status" TYPE "ProjectStatus_new" USING ("status"::text::"ProjectStatus_new");
ALTER TABLE "project_status_config" ALTER COLUMN "status" TYPE "ProjectStatus_new" USING ("status"::text::"ProjectStatus_new");
ALTER TYPE "ProjectStatus" RENAME TO "ProjectStatus_old";
ALTER TYPE "ProjectStatus_new" RENAME TO "ProjectStatus";
DROP TYPE "ProjectStatus_old";
ALTER TABLE "projects" ALTER COLUMN "status" SET DEFAULT 'UNDER_STUDY';
COMMIT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "stage" "ProjectStage" NOT NULL DEFAULT 'TENDERING',
ALTER COLUMN "status" SET DEFAULT 'UNDER_STUDY';
