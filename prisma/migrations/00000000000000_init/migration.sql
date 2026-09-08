-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "brandStyle" TEXT NOT NULL DEFAULT 'streetwear',
    "aiStyleNotes" TEXT,
    "accentColor" TEXT NOT NULL DEFAULT '#000000',
    "language" TEXT NOT NULL DEFAULT 'pl',
    "monthlyLimit" INTEGER NOT NULL DEFAULT 150,
    "requestsUsed" INTEGER NOT NULL DEFAULT 0,
    "usageMonth" TEXT,
    "subscriptionId" TEXT,
    "askFitPreference" BOOLEAN NOT NULL DEFAULT false,
    "askGarmentMatch" BOOLEAN NOT NULL DEFAULT false,
    "widgetLanguage" TEXT NOT NULL DEFAULT 'auto',
    "widgetCustomCss" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRule" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT,
    "parsedSizeData" TEXT,
    "customNotes" TEXT,
    "sizeChartImage" TEXT,
    "extractionJson" TEXT,
    "extractionAt" TIMESTAMP(3),
    "extractionModel" TEXT,
    "extractionVersion" INTEGER,
    "extractionError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAnalysis" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "extractionJson" TEXT NOT NULL,
    "extractionModel" TEXT,
    "extractionVersion" INTEGER NOT NULL,
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorLog" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "customerHeight" INTEGER NOT NULL,
    "customerWeight" INTEGER NOT NULL,
    "customerGender" TEXT NOT NULL,
    "bodyType" TEXT NOT NULL,
    "recommendedSize" TEXT NOT NULL,
    "addedToCart" BOOLEAN NOT NULL DEFAULT false,
    "purchased" BOOLEAN NOT NULL DEFAULT false,
    "orderId" TEXT,
    "orderTotal" DOUBLE PRECISION,
    "orderCurrency" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_shop_key" ON "ShopSettings"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "ProductRule_shopId_productId_key" ON "ProductRule"("shopId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAnalysis_shopId_productId_key" ON "ProductAnalysis"("shopId", "productId");

-- AddForeignKey
ALTER TABLE "ProductRule" ADD CONSTRAINT "ProductRule_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAnalysis" ADD CONSTRAINT "ProductAnalysis_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisorLog" ADD CONSTRAINT "AdvisorLog_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "ShopSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

