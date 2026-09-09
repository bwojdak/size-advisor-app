-- SizingSystem: współdzielona nazwana rozmiarówka, jeden system -> wiele produktów
CREATE TABLE "SizingSystem" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parsedSizeData" TEXT,
    "customNotes" TEXT,
    "extractionJson" TEXT,
    "extractionAt" TIMESTAMP(3),
    "extractionModel" TEXT,
    "extractionVersion" INTEGER,
    "extractionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SizingSystem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SizingSystem_shopId_name_key" ON "SizingSystem"("shopId", "name");

ALTER TABLE "SizingSystem" ADD CONSTRAINT "SizingSystem_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ProductRule: opcjonalne wskazanie na współdzielony system rozmiarów
ALTER TABLE "ProductRule" ADD COLUMN "sizingSystemId" TEXT;

ALTER TABLE "ProductRule" ADD CONSTRAINT "ProductRule_sizingSystemId_fkey" FOREIGN KEY ("sizingSystemId") REFERENCES "SizingSystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
