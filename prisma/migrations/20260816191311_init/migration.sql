-- CreateTable
CREATE TABLE "takeoff_drawings" (
    "id" TEXT NOT NULL,
    "drawingNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "weightFromDwg" DOUBLE PRECISION,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "takeoff_drawings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "takeoff_parts" (
    "id" TEXT NOT NULL,
    "itemNo" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "extWidth" DOUBLE PRECISION,
    "extLength" DOUBLE PRECISION,
    "intWidth" DOUBLE PRECISION,
    "intLength" DOUBLE PRECISION,
    "qty" INTEGER NOT NULL,
    "thicknessMm" DOUBLE PRECISION NOT NULL,
    "extUnitArea" DOUBLE PRECISION NOT NULL,
    "intUnitArea" DOUBLE PRECISION NOT NULL,
    "totalUnitArea" DOUBLE PRECISION NOT NULL,
    "totalArea" DOUBLE PRECISION NOT NULL,
    "volume" DOUBLE PRECISION NOT NULL,
    "weightKg" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "drawingId" TEXT NOT NULL,

    CONSTRAINT "takeoff_parts_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "takeoff_drawings" ADD CONSTRAINT "takeoff_drawings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "takeoff_parts" ADD CONSTRAINT "takeoff_parts_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "takeoff_drawings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
