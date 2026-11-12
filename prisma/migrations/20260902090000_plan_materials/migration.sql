-- Material follow-up (procurement tracking) — purely additive: two new tables.

CREATE TABLE IF NOT EXISTS "plan_materials" (
  "id" TEXT NOT NULL,
  "code" TEXT,
  "description" TEXT NOT NULL,
  "spec" TEXT,
  "unit" TEXT NOT NULL DEFAULT 'kg',
  "requiredQty" DOUBLE PRECISION NOT NULL,
  "neededBy" TIMESTAMP(3),
  "notes" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "wbsId" TEXT,
  "activityId" TEXT,
  "createdById" TEXT NOT NULL,
  CONSTRAINT "plan_materials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "plan_material_orders" (
  "id" TEXT NOT NULL,
  "supplier" TEXT NOT NULL,
  "poNumber" TEXT,
  "orderedQty" DOUBLE PRECISION NOT NULL,
  "unitPrice" DOUBLE PRECISION,
  "orderDate" TIMESTAMP(3),
  "expectedDate" TIMESTAMP(3),
  "receivedQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "receivedDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "materialId" TEXT NOT NULL,
  CONSTRAINT "plan_material_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "plan_materials_projectId_sortOrder_idx" ON "plan_materials"("projectId", "sortOrder");
CREATE INDEX IF NOT EXISTS "plan_material_orders_materialId_idx" ON "plan_material_orders"("materialId");

DO $$ BEGIN ALTER TABLE "plan_materials" ADD CONSTRAINT "plan_materials_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_materials" ADD CONSTRAINT "plan_materials_wbsId_fkey" FOREIGN KEY ("wbsId") REFERENCES "plan_wbs"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_materials" ADD CONSTRAINT "plan_materials_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "plan_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_materials" ADD CONSTRAINT "plan_materials_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "plan_material_orders" ADD CONSTRAINT "plan_material_orders_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "plan_materials"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
