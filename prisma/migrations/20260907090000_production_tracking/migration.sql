-- Production tracking: work orders (one per takeoff part) and their pieces, followed stage by stage. Additive only.

ALTER TABLE "projects" ADD COLUMN "productionWbsId" TEXT;

CREATE TABLE "work_orders" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "partNo" INTEGER,
  "partId" TEXT,
  "material" TEXT,
  "qty" INTEGER NOT NULL,
  "unitWeightKg" DOUBLE PRECISION NOT NULL,
  "dueDate" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectId" TEXT NOT NULL,
  CONSTRAINT "work_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_order_pieces" (
  "id" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "cutAt" TIMESTAMP(3),
  "assembledAt" TIMESTAMP(3),
  "weldedAt" TIMESTAMP(3),
  "paintedAt" TIMESTAMP(3),
  "workOrderId" TEXT NOT NULL,
  CONSTRAINT "work_order_pieces_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "work_orders_number_key" ON "work_orders"("number");
CREATE INDEX "work_orders_projectId_idx" ON "work_orders"("projectId");
CREATE UNIQUE INDEX "work_order_pieces_workOrderId_seq_key" ON "work_order_pieces"("workOrderId", "seq");

ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_order_pieces" ADD CONSTRAINT "work_order_pieces_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "work_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
