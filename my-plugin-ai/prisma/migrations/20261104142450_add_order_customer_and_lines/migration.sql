-- AlterTable
ALTER TABLE "OrderHistory" ADD COLUMN "customerId" TEXT;
ALTER TABLE "OrderHistory" ADD COLUMN "lines" TEXT;

-- CreateIndex
CREATE INDEX "OrderHistory_shop_customerId_idx" ON "OrderHistory"("shop", "customerId");
