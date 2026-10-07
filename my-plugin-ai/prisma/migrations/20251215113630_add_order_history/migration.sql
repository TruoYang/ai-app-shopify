-- CreateTable
CREATE TABLE "OrderHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productIds" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'shopify',
    "orderDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "OrderHistory_shop_idx" ON "OrderHistory"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "OrderHistory_shop_orderId_key" ON "OrderHistory"("shop", "orderId");
