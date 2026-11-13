-- Quotations — purely additive: two enums and three new tables.

DO $$ BEGIN
  CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "QuotationItemType" AS ENUM ('SUPPLY', 'INSTALL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "quotations" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "section" TEXT,
  "description" TEXT NOT NULL,
  "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "issueDate" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3),
  "profitMargin" DOUBLE PRECISION,
  "preparedBy" TEXT,
  "approvedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "terms" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "quotations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quotation_items" (
  "id" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "description" TEXT NOT NULL,
  "material" TEXT,
  "qty" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'kg',
  "unitRate" DOUBLE PRECISION NOT NULL,
  "type" "QuotationItemType" NOT NULL DEFAULT 'SUPPLY',
  "quotationId" TEXT NOT NULL,
  CONSTRAINT "quotation_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "quotation_events" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "quotationId" TEXT NOT NULL,
  "userId" TEXT,
  CONSTRAINT "quotation_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "quotations_projectId_number_revision_key" ON "quotations"("projectId", "number", "revision");
CREATE INDEX IF NOT EXISTS "quotations_projectId_issueDate_idx" ON "quotations"("projectId", "issueDate");
CREATE INDEX IF NOT EXISTS "quotation_items_quotationId_sortOrder_idx" ON "quotation_items"("quotationId", "sortOrder");
CREATE INDEX IF NOT EXISTS "quotation_events_quotationId_createdAt_idx" ON "quotation_events"("quotationId", "createdAt");

DO $$ BEGIN ALTER TABLE "quotations" ADD CONSTRAINT "quotations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "quotations" ADD CONSTRAINT "quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "quotation_items" ADD CONSTRAINT "quotation_items_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "quotation_events" ADD CONSTRAINT "quotation_events_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "quotation_events" ADD CONSTRAINT "quotation_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
