-- Convert to execution: the budget frozen from the approved quotations and when it happened. Additive only.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "executionBudget" JSONB;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "executionStartedAt" TIMESTAMP(3);
