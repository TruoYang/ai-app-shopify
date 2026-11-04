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
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ShopSettings" ("shop", "trainFrom", "trainLastMonths", "trainTo", "updatedAt") SELECT "shop", "trainFrom", "trainLastMonths", "trainTo", "updatedAt" FROM "ShopSettings";
DROP TABLE "ShopSettings";
ALTER TABLE "new_ShopSettings" RENAME TO "ShopSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
