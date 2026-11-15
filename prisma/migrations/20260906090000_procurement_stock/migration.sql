-- Procurement (suppliers, purchase orders, goods receipts) and the remnant stock. Additive only.

CREATE TYPE "PurchaseOrderStatus" AS ENUM ('ISSUED', 'CANCELLED');
CREATE TYPE "StockKind" AS ENUM ('SHEET', 'REMNANT');

ALTER TABLE "plan_material_orders" ADD COLUMN "purchaseOrderId" TEXT;

CREATE TABLE "suppliers" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "contactName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "address" TEXT,
  "notes" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_orders" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'ISSUED',
  "currency" TEXT NOT NULL DEFAULT 'EGP',
  "orderDate" TIMESTAMP(3) NOT NULL,
  "expectedDate" TIMESTAMP(3),
  "paymentTerms" TEXT,
  "notes" TEXT,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectId" TEXT NOT NULL,
  "supplierId" TEXT NOT NULL,
  CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipts" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "receivedDate" TIMESTAMP(3) NOT NULL,
  "deliveryNote" TEXT,
  "notes" TEXT,
  "receivedByName" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "purchaseOrderId" TEXT NOT NULL,
  CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "goods_receipt_lines" (
  "id" TEXT NOT NULL,
  "qty" DOUBLE PRECISION NOT NULL,
  "accepted" BOOLEAN NOT NULL DEFAULT true,
  "heatNo" TEXT,
  "certificateRef" TEXT,
  "notes" TEXT,
  "receiptId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_items" (
  "id" TEXT NOT NULL,
  "kind" "StockKind" NOT NULL DEFAULT 'REMNANT',
  "material" TEXT NOT NULL DEFAULT '',
  "thicknessMm" DOUBLE PRECISION NOT NULL,
  "widthMm" DOUBLE PRECISION NOT NULL,
  "heightMm" DOUBLE PRECISION NOT NULL,
  "qty" INTEGER NOT NULL DEFAULT 1,
  "location" TEXT,
  "heatNo" TEXT,
  "notes" TEXT,
  "origin" TEXT NOT NULL DEFAULT 'MANUAL',
  "originProjectId" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_movements" (
  "id" TEXT NOT NULL,
  "delta" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "projectId" TEXT,
  "note" TEXT,
  "userName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stockItemId" TEXT NOT NULL,
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppliers_name_key" ON "suppliers"("name");
CREATE UNIQUE INDEX "purchase_orders_number_key" ON "purchase_orders"("number");
CREATE INDEX "purchase_orders_projectId_orderDate_idx" ON "purchase_orders"("projectId", "orderDate");
CREATE UNIQUE INDEX "goods_receipts_number_key" ON "goods_receipts"("number");
CREATE INDEX "goods_receipts_purchaseOrderId_idx" ON "goods_receipts"("purchaseOrderId");
CREATE INDEX "goods_receipt_lines_receiptId_idx" ON "goods_receipt_lines"("receiptId");
CREATE INDEX "goods_receipt_lines_orderId_idx" ON "goods_receipt_lines"("orderId");
CREATE INDEX "goods_receipt_lines_heatNo_idx" ON "goods_receipt_lines"("heatNo");
CREATE INDEX "stock_items_thicknessMm_material_idx" ON "stock_items"("thicknessMm", "material");
CREATE INDEX "stock_movements_stockItemId_createdAt_idx" ON "stock_movements"("stockItemId", "createdAt");
CREATE INDEX "plan_material_orders_purchaseOrderId_idx" ON "plan_material_orders"("purchaseOrderId");

ALTER TABLE "plan_material_orders" ADD CONSTRAINT "plan_material_orders_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "plan_material_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "stock_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
