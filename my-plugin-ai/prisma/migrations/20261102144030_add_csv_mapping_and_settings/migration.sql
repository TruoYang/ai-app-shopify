-- CreateTable
CREATE TABLE "CsvImport" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "columnMap" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CsvProduct" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "shopProductKey" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "trainFrom" DATETIME,
    "trainTo" DATETIME,
    "trainLastMonths" INTEGER,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "CsvImport_shop_idx" ON "CsvImport"("shop");

-- CreateIndex
CREATE INDEX "CsvProduct_shop_orderCount_idx" ON "CsvProduct"("shop", "orderCount");

-- CreateIndex
CREATE UNIQUE INDEX "CsvProduct_shop_code_key" ON "CsvProduct"("shop", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CsvProduct_shop_shopProductKey_key" ON "CsvProduct"("shop", "shopProductKey");
