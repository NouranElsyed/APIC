-- Documents screen: an optional folder per document and user-created folders. Additive only.

ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "folder" TEXT;

CREATE TABLE IF NOT EXISTS "document_folders" (
  "id" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectId" TEXT NOT NULL,
  CONSTRAINT "document_folders_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "document_folders_projectId_path_key" ON "document_folders"("projectId", "path");

DO $$ BEGIN ALTER TABLE "document_folders" ADD CONSTRAINT "document_folders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
