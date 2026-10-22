-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RecommendationRule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "cartProducts" TEXT NOT NULL,
    "cartSize" INTEGER NOT NULL,
    "suggestProduct" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "support" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'model',
    "status" TEXT NOT NULL DEFAULT 'active',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "discountPercent" REAL,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_RecommendationRule" ("cartProducts", "cartSize", "confidence", "id", "shop", "suggestProduct", "support", "updatedAt") SELECT "cartProducts", "cartSize", "confidence", "id", "shop", "suggestProduct", "support", "updatedAt" FROM "RecommendationRule";
DROP TABLE "RecommendationRule";
ALTER TABLE "new_RecommendationRule" RENAME TO "RecommendationRule";
CREATE INDEX "RecommendationRule_shop_status_cartSize_idx" ON "RecommendationRule"("shop", "status", "cartSize");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
