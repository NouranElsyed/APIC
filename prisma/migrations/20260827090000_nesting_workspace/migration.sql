-- Nesting workspace auto-save — purely additive (one new table).
CREATE TABLE IF NOT EXISTS "nesting_workspaces" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "dataJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "updatedById" TEXT,
  CONSTRAINT "nesting_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "nesting_workspaces_projectId_kind_key"
  ON "nesting_workspaces"("projectId", "kind");

DO $$ BEGIN
  ALTER TABLE "nesting_workspaces" ADD CONSTRAINT "nesting_workspaces_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
