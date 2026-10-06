-- Per-user nesting history — purely additive (one new table).
CREATE TABLE IF NOT EXISTS "nesting_history" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "data2D" JSONB,
  "data1D" JSONB,
  "savedProjectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,
  CONSTRAINT "nesting_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "nesting_history_userId_updatedAt_idx"
  ON "nesting_history"("userId", "updatedAt");

DO $$ BEGIN
  ALTER TABLE "nesting_history" ADD CONSTRAINT "nesting_history_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
