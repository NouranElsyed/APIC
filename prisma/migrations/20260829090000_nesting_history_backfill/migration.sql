-- Moves the projects that the old "import creates a project" behaviour made automatically
-- ("<user> — <date>", client "Unassigned", description "Auto-created from a DXF / CSV import…")
-- into the owner's nesting history, then removes them from the project list.
--
-- Safe by construction:
--   * only projects that hold NOTHING besides their nesting workspace are touched (a project with
--     documents, takeoff drawings/parts, scope items, notices, minutes or nesting jobs stays a project);
--   * a project is deleted only after its history copy exists;
--   * re-running does nothing (history ids are 'mig_<projectId>').

INSERT INTO "nesting_history" ("id", "name", "data2D", "data1D", "createdAt", "updatedAt", "userId")
SELECT
  'mig_' || p."id",
  p."name",
  (SELECT w."dataJson" FROM "nesting_workspaces" w WHERE w."projectId" = p."id" AND w."kind" = '2D'),
  (SELECT w."dataJson" FROM "nesting_workspaces" w WHERE w."projectId" = p."id" AND w."kind" = '1D'),
  p."createdAt",
  COALESCE((SELECT MAX(w."updatedAt") FROM "nesting_workspaces" w WHERE w."projectId" = p."id"), p."updatedAt"),
  p."createdById"
FROM "projects" p
JOIN "customers" c ON c."id" = p."customerId"
WHERE c."code" = 'UNASSIGNED'
  AND p."number" LIKE 'NEST-%'
  AND p."description" LIKE 'Auto-created from a DXF / CSV import%'
  AND NOT EXISTS (SELECT 1 FROM "documents" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "takeoff_drawings" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "scope_items" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "notices" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "meeting_minutes" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "nesting_jobs" x WHERE x."projectId" = p."id")
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "projects" p
USING "customers" c
WHERE c."id" = p."customerId"
  AND c."code" = 'UNASSIGNED'
  AND p."number" LIKE 'NEST-%'
  AND p."description" LIKE 'Auto-created from a DXF / CSV import%'
  AND EXISTS (SELECT 1 FROM "nesting_history" h WHERE h."id" = 'mig_' || p."id")
  AND NOT EXISTS (SELECT 1 FROM "documents" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "takeoff_drawings" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "scope_items" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "notices" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "meeting_minutes" x WHERE x."projectId" = p."id")
  AND NOT EXISTS (SELECT 1 FROM "nesting_jobs" x WHERE x."projectId" = p."id");
