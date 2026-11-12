-- Planning & Follow-up module — purely additive (new enums + new tables, nothing existing is touched).

DO $$ BEGIN
  CREATE TYPE "PlanActivityType" AS ENUM ('TASK', 'MILESTONE_START', 'MILESTONE_FINISH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PlanRelType" AS ENUM ('FS', 'SS', 'FF', 'SF');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "plan_schedules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "dataDate" TIMESTAMP(3) NOT NULL,
  "finishDate" TIMESTAMP(3),
  "defaultCalendarId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'NATIVE',
  "p6ProjectId" TEXT,
  "calcError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "plan_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_calendars" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "workDays" JSONB NOT NULL,
  "holidays" JSONB NOT NULL,
  "workExceptions" JSONB NOT NULL,
  "hoursPerDay" DOUBLE PRECISION NOT NULL DEFAULT 8,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "p6Id" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduleId" TEXT NOT NULL,
  CONSTRAINT "plan_calendars_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_wbs" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "p6Id" TEXT,
  "scheduleId" TEXT NOT NULL,
  "parentId" TEXT,
  CONSTRAINT "plan_wbs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_activities" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "PlanActivityType" NOT NULL DEFAULT 'TASK',
  "durationDays" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "remainingDays" DOUBLE PRECISION,
  "percentComplete" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "actualStart" TIMESTAMP(3),
  "actualFinish" TIMESTAMP(3),
  "constraintType" TEXT,
  "constraintDate" TIMESTAMP(3),
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "earlyStart" TIMESTAMP(3),
  "earlyFinish" TIMESTAMP(3),
  "lateStart" TIMESTAMP(3),
  "lateFinish" TIMESTAMP(3),
  "totalFloat" DOUBLE PRECISION,
  "isCritical" BOOLEAN NOT NULL DEFAULT false,
  "p6Id" TEXT,
  "p6Raw" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "wbsId" TEXT,
  "calendarId" TEXT,
  CONSTRAINT "plan_activities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_relationships" (
  "id" TEXT NOT NULL,
  "type" "PlanRelType" NOT NULL DEFAULT 'FS',
  "lagDays" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "scheduleId" TEXT NOT NULL,
  "predecessorId" TEXT NOT NULL,
  "successorId" TEXT NOT NULL,
  CONSTRAINT "plan_relationships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_baselines" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT true,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduleId" TEXT NOT NULL,
  "createdById" TEXT,
  CONSTRAINT "plan_baselines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_progress_snapshots" (
  "id" TEXT NOT NULL,
  "dataDate" TIMESTAMP(3) NOT NULL,
  "percent" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "scheduleId" TEXT NOT NULL,
  CONSTRAINT "plan_progress_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "plan_schedules_projectId_key" ON "plan_schedules"("projectId");
CREATE INDEX IF NOT EXISTS "plan_calendars_scheduleId_idx" ON "plan_calendars"("scheduleId");
CREATE INDEX IF NOT EXISTS "plan_wbs_scheduleId_idx" ON "plan_wbs"("scheduleId");
CREATE UNIQUE INDEX IF NOT EXISTS "plan_activities_scheduleId_code_key" ON "plan_activities"("scheduleId", "code");
CREATE INDEX IF NOT EXISTS "plan_activities_scheduleId_sortOrder_idx" ON "plan_activities"("scheduleId", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "plan_relationships_predecessorId_successorId_type_key" ON "plan_relationships"("predecessorId", "successorId", "type");
CREATE INDEX IF NOT EXISTS "plan_relationships_scheduleId_idx" ON "plan_relationships"("scheduleId");
CREATE INDEX IF NOT EXISTS "plan_baselines_scheduleId_idx" ON "plan_baselines"("scheduleId");
CREATE UNIQUE INDEX IF NOT EXISTS "plan_progress_snapshots_scheduleId_dataDate_key" ON "plan_progress_snapshots"("scheduleId", "dataDate");

DO $$ BEGIN ALTER TABLE "plan_schedules" ADD CONSTRAINT "plan_schedules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_schedules" ADD CONSTRAINT "plan_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_calendars" ADD CONSTRAINT "plan_calendars_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "plan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_wbs" ADD CONSTRAINT "plan_wbs_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "plan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_wbs" ADD CONSTRAINT "plan_wbs_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "plan_wbs"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_activities" ADD CONSTRAINT "plan_activities_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "plan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_activities" ADD CONSTRAINT "plan_activities_wbsId_fkey" FOREIGN KEY ("wbsId") REFERENCES "plan_wbs"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_activities" ADD CONSTRAINT "plan_activities_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "plan_calendars"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_relationships" ADD CONSTRAINT "plan_relationships_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "plan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_relationships" ADD CONSTRAINT "plan_relationships_predecessorId_fkey" FOREIGN KEY ("predecessorId") REFERENCES "plan_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_relationships" ADD CONSTRAINT "plan_relationships_successorId_fkey" FOREIGN KEY ("successorId") REFERENCES "plan_activities"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_baselines" ADD CONSTRAINT "plan_baselines_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "plan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_baselines" ADD CONSTRAINT "plan_baselines_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_progress_snapshots" ADD CONSTRAINT "plan_progress_snapshots_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "plan_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
