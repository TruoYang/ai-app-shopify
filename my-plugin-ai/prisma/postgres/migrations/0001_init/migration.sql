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

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationRule" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "cartProducts" TEXT NOT NULL,
    "cartSize" INTEGER NOT NULL,
    "suggestProduct" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "support" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'model',
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderHistory" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productIds" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'shopify',
    "orderDate" TIMESTAMP(3),
    "customerId" TEXT,
    "lines" TEXT,
    "csvOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvImport" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "columnMap" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CsvImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CsvProduct" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "shopProductKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CsvProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "trainFrom" TIMESTAMP(3),
    "trainTo" TIMESTAMP(3),
    "trainLastMonths" INTEGER,
    "strategy" TEXT NOT NULL DEFAULT 'apriori',
    "rankBy" TEXT NOT NULL DEFAULT 'balanced',
    "retrainSchedule" TEXT NOT NULL DEFAULT 'none',
    "lastTrainedAt" TIMESTAMP(3),
    "lastTrainSummary" TEXT,
    "abEnabled" BOOLEAN NOT NULL DEFAULT false,
    "abControlShare" INTEGER NOT NULL DEFAULT 50,
    "abStartedAt" TIMESTAMP(3),
    "lastReplaySummary" TEXT,
    "language" TEXT NOT NULL DEFAULT 'auto',
    "adminLocale" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "RecommendationEvent" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'ai',
    "placement" TEXT,
    "productKey" TEXT,
    "reason" TEXT,
    "items" TEXT,
    "value" DOUBLE PRECISION,
    "recValue" DOUBLE PRECISION,
    "orderId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecommendationRule_shop_status_cartSize_idx" ON "RecommendationRule"("shop", "status", "cartSize");

-- CreateIndex
CREATE INDEX "OrderHistory_shop_idx" ON "OrderHistory"("shop");

-- CreateIndex
CREATE INDEX "OrderHistory_shop_customerId_idx" ON "OrderHistory"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderHistory_shop_orderId_key" ON "OrderHistory"("shop", "orderId");

-- CreateIndex
CREATE INDEX "CsvImport_shop_idx" ON "CsvImport"("shop");

-- CreateIndex
CREATE INDEX "CsvProduct_shop_orderCount_idx" ON "CsvProduct"("shop", "orderCount");

-- CreateIndex
CREATE UNIQUE INDEX "CsvProduct_shop_code_key" ON "CsvProduct"("shop", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CsvProduct_shop_shopProductKey_key" ON "CsvProduct"("shop", "shopProductKey");

-- CreateIndex
CREATE INDEX "RecommendationEvent_shop_simulated_createdAt_idx" ON "RecommendationEvent"("shop", "simulated", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationEvent_shop_type_productKey_idx" ON "RecommendationEvent"("shop", "type", "productKey");

