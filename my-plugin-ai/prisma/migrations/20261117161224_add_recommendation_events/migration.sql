-- CreateTable
CREATE TABLE "RecommendationEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'ai',
    "placement" TEXT,
    "productKey" TEXT,
    "reason" TEXT,
    "items" TEXT,
    "value" REAL,
    "recValue" REAL,
    "orderId" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "trainFrom" DATETIME,
    "trainTo" DATETIME,
    "trainLastMonths" INTEGER,
    "strategy" TEXT NOT NULL DEFAULT 'apriori',
    "rankBy" TEXT NOT NULL DEFAULT 'balanced',
    "retrainSchedule" TEXT NOT NULL DEFAULT 'none',
    "lastTrainedAt" DATETIME,
    "lastTrainSummary" TEXT,
    "abEnabled" BOOLEAN NOT NULL DEFAULT false,
    "abControlShare" INTEGER NOT NULL DEFAULT 50,
    "abStartedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("lastTrainSummary", "lastTrainedAt", "rankBy", "retrainSchedule", "shop", "strategy", "trainFrom", "trainLastMonths", "trainTo", "updatedAt") SELECT "lastTrainSummary", "lastTrainedAt", "rankBy", "retrainSchedule", "shop", "strategy", "trainFrom", "trainLastMonths", "trainTo", "updatedAt" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RecommendationEvent_shop_simulated_createdAt_idx" ON "RecommendationEvent"("shop", "simulated", "createdAt");

-- CreateIndex
CREATE INDEX "RecommendationEvent_shop_type_productKey_idx" ON "RecommendationEvent"("shop", "type", "productKey");
