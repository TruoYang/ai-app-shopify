// Training run shared by the Train button (routes/api.train.jsx) and the scheduler
// (scheduler.server.js): sync Shopify orders, mine rules with the shop's strategy, and
// replace the model rules while keeping merchant rules and merchant edits.

import { trainModelFromDb } from "./ai-logic";
import prisma from "./db.server";
import { getShopCatalog, toProductKey } from "./catalog.server";
import { buildTrainingDataset, getTrainingWindow, loadTrainingOrders, mapCsvOrders } from "./training-data.server";
import { PYTHON_STRATEGIES, trainWithPython } from "./python-trainer.server";

// Only merchant-authored rules (source "merchant") survive a retrain; model rules are replaced.
const MODEL_SOURCE = "model";

/**
 * Returns a JSON Response with { success, stats } (or { success: false, error }).
 * adminForSync: Admin API client used to sync orders and read the catalog (optional).
 */
export async function runTraining({ shop, adminForSync = null, authState = "scheduled", authError = null }) {
  try {
    // 1. Get orders from database (separate CSV vs Shopify sources), inside the training window
    const trainingWindow = await getTrainingWindow(shop);
    let csvOrders = await loadTrainingOrders(shop, "csv_import", trainingWindow);
    let shopifyOrders = await loadTrainingOrders(shop, "shopify", trainingWindow);

    let shopifyFetchedCount = 0;
    let shopifyInsertedCount = 0;
    let shopifySavedSingleItem = 0;
    let shopifySkippedNoProducts = 0;
    let shopifySyncAttempted = false;
    let shopifySyncError = null;

    // console.log(`Orders in database: ${dbOrders.length}`);

    // 2. Sync real orders from Shopify to database (need admin auth)
    if (adminForSync) {
      try {
        shopifySyncAttempted = true;
        // console.log("Syncing orders from Shopify...");
        
        // Paginate to fetch all paid orders (up to ~1000 as requested)
        const shopifyOrdersFromApi = [];
        let hasNextPage = true;
        let afterCursor = null;

        while (hasNextPage) {
          const response = await adminForSync.graphql(
            `
              query getPaidOrders($after: String) {
                orders(first: 100, after: $after, query: "status:any -tag:csv-demo") {
                  edges {
                    cursor
                    node {
                      id
                      processedAt
                      customer { id }
                      lineItems(first: 50) {
                        edges {
                          node {
                            sku
                            quantity
                            originalUnitPriceSet { shopMoney { amount } }
                          }
                        }
                      }
                    }
                  }
                  pageInfo { hasNextPage }
                }
              }
            `,
            { variables: { after: afterCursor } }
          );

          // Check if response is a redirect
          if (!response.ok || response.status === 302) {
            console.warn("Shopify auth redirect, skipping sync");
            throw new Error("Shopify requires re-authentication");
          }

          const result = await response.json();

          if (result.errors && result.errors.length > 0) {
            console.error("Shopify GraphQL errors:", result.errors);
            throw new Error(result.errors[0]?.message || "Shopify GraphQL error");
          }

          const edges = result.data?.orders?.edges || [];
          edges.forEach((edge) => shopifyOrdersFromApi.push(edge.node));
          hasNextPage = Boolean(result.data?.orders?.pageInfo?.hasNextPage);
          afterCursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;

          if (!afterCursor) {
            hasNextPage = false;
          }
        }
        
        // console.log(`Shopify orders fetched: ${shopifyOrders.length}`);
        
        // Save orders from Shopify to database. Orders tagged csv-demo were created from the
        // CSV history (scripts/demo/push-demo-orders.mjs) and are already stored as CSV orders.
        shopifyFetchedCount = shopifyOrdersFromApi.length;

        for (const order of shopifyOrdersFromApi) {
          const productSkus = order.lineItems.edges
            .map(edge => edge.node.sku)
            .filter(sku => typeof sku === "string" && sku.trim().length > 0);

          const uniqueSkus = [...new Set(productSkus)].sort();

          if (uniqueSkus.length === 0) {
            shopifySkippedNoProducts++;
            continue;
          }

          const details = {
            productIds: JSON.stringify(uniqueSkus),
            orderDate: order.processedAt ? new Date(order.processedAt) : null,
            customerId: order.customer?.id ?? null,
            lines: JSON.stringify(order.lineItems.edges
              .filter((edge) => edge.node.sku?.trim())
              .map((edge) => ({
                code: edge.node.sku.trim(),
                quantity: edge.node.quantity,
                price: Number(edge.node.originalUnitPriceSet?.shopMoney?.amount ?? 0),
              }))),
          };
          await prisma.orderHistory.upsert({
            where: { 
              shop_orderId: { shop, orderId: order.id }
            },
            update: details,
            create: { shop, orderId: order.id, source: "shopify", ...details }
          });
          shopifyInsertedCount++;

          if (uniqueSkus.length < 2) {
            shopifySavedSingleItem++;
          }
        }
        
        console.log(
          `Shopify orders fetched=${shopifyFetchedCount}, inserted=${shopifyInsertedCount}, ` +
          `savedSingleItem=${shopifySavedSingleItem}, skippedNoProducts=${shopifySkippedNoProducts}`
        );

        // Re-fetch from database after sync
        csvOrders = await loadTrainingOrders(shop, "csv_import", trainingWindow);
        shopifyOrders = await loadTrainingOrders(shop, "shopify", trainingWindow);
        
      } catch (syncErr) {
        shopifySyncError = syncErr?.message || String(syncErr);
        console.warn("Could not sync from Shopify (will use existing data):", syncErr.message);
      }
    } else {
      console.log("No admin auth, skipping Shopify sync (using existing DB data only)");
    }

    // 3. Check if there is data
    if (csvOrders.length === 0 && shopifyOrders.length === 0) {
      return Response.json({
        success: false,
        error: "empty data"
      }, { status: 400 });
    }

    // 4. Train model from database orders (separate CSV vs Shopify)
    // Learn on products, not sizes: map variant SKUs to product keys before mining.
    const catalog = adminForSync ? await getShopCatalog(shop, adminForSync) : null;
    const toProductOrders = (orders) => catalog
      ? orders.map((order) => {
          try {
            const skus = JSON.parse(order.productIds);
            return { productIds: JSON.stringify([...new Set(skus.map((sku) => toProductKey(catalog, String(sku).trim())))]) };
          } catch {
            return order;
          }
        })
      : orders;

    // CSV codes become shop products through the matches made on the Data page.
    const csvMapping = await mapCsvOrders(shop, csvOrders);
    const csvRules = csvOrders.length > 0 ? trainModelFromDb(toProductOrders(csvMapping.orders), shop) : [];
    const shopifyRules = shopifyOrders.length > 0 ? trainModelFromDb(toProductOrders(shopifyOrders), shop) : [];

    // Merge rules (prefer higher support/confidence for duplicates)
    const mergedRulesMap = new Map();
    const mergeRules = (rulesList) => {
      for (const rule of rulesList) {
        const key = `${rule.cartProducts}|${rule.suggestProduct}`;
        const existing = mergedRulesMap.get(key);
        if (!existing) {
          mergedRulesMap.set(key, rule);
          continue;
        }
        if (rule.support > existing.support) {
          mergedRulesMap.set(key, rule);
          continue;
        }
        if (rule.support === existing.support && rule.confidence > existing.confidence) {
          mergedRulesMap.set(key, rule);
        }
      }
    };

    // The merchant's strategy decides the miner; Python algorithms fall back to the
    // built-in Apriori when Python is missing or fails, so training always produces rules.
    const settings = await prisma.shopSettings.findUnique({ where: { shop } });
    const strategy = settings?.strategy ?? "apriori";
    let usedStrategy = "apriori";
    let strategyError = null;
    if (PYTHON_STRATEGIES.includes(strategy)) {
      try {
        const dataset = await buildTrainingDataset(shop, catalog ? (sku) => toProductKey(catalog, sku) : undefined);
        const { rules: pythonRules } = await trainWithPython(dataset, strategy);
        mergeRules(pythonRules.map((rule) => ({
          shop,
          cartProducts: JSON.stringify(rule.cart),
          cartSize: rule.cart.length,
          suggestProduct: rule.suggest,
          confidence: Math.round(rule.confidence * 1000) / 1000,
          support: rule.support,
        })));
        usedStrategy = strategy;
      } catch (error) {
        strategyError = error.message;
        console.warn(`Python strategy ${strategy} failed, using Apriori:`, error.message);
      }
    }
    if (usedStrategy === "apriori") {
      mergeRules(csvRules);
      mergeRules(shopifyRules);
    }

    // 4. Save rules: keep merchant rules, and carry over merchant edits
    // (disabled status, discount, priority) on model rules that are trained again.
    const ruleKey = (rule) => `${rule.cartProducts}|${rule.suggestProduct}`;
    const existingRules = await prisma.recommendationRule.findMany({
      where: { shop },
      select: { cartProducts: true, suggestProduct: true, source: true, status: true, priority: true, discountPercent: true },
    });
    const merchantKeys = new Set(
      existingRules.filter((rule) => rule.source !== MODEL_SOURCE).map(ruleKey),
    );
    const editedModelRules = new Map(
      existingRules
        .filter((rule) => rule.source === MODEL_SOURCE &&
          (rule.status !== "active" || rule.priority !== 0 || rule.discountPercent !== null))
        .map((rule) => [ruleKey(rule), rule]),
    );

    const rules = Array.from(mergedRulesMap.values())
      .filter((rule) => !merchantKeys.has(ruleKey(rule)))
      .map((rule) => {
        const edited = editedModelRules.get(ruleKey(rule));
        return {
          ...rule,
          source: MODEL_SOURCE,
          ...(edited
            ? { status: edited.status, priority: edited.priority, discountPercent: edited.discountPercent }
            : {}),
        };
      });

    await prisma.$transaction([
      prisma.recommendationRule.deleteMany({ where: { shop, source: MODEL_SOURCE } }),
      ...(rules.length > 0 ? [prisma.recommendationRule.createMany({ data: rules })] : []),
    ]);

    console.log("TRAINED RULES (merged):", rules.length);
    await prisma.shopSettings.upsert({
      where: { shop },
      update: { lastTrainedAt: new Date(), lastTrainSummary: JSON.stringify({ strategy: usedStrategy, rules: rules.length, strategyError }) },
      create: { shop, lastTrainedAt: new Date(), lastTrainSummary: JSON.stringify({ strategy: usedStrategy, rules: rules.length, strategyError }) },
    });

    // 5. List stats
    const cart1Rules = rules.filter(r => r.cartSize === 1).length;
    const cart2Rules = rules.filter(r => r.cartSize === 2).length;

    return Response.json({
      success: true,
      message: "Training thành công!",
      stats: {
        ordersProcessed: csvOrders.length + shopifyOrders.length,
        totalRules: rules.length,
        cart1Rules,
        cart2Rules,
        strategy: usedStrategy,
        strategyError,
        csvMatchedProducts: csvMapping.matchedProducts,
        csvUnmatchedItems: csvMapping.droppedCodes,
        trainingWindow,
        rulesFromCsv: csvRules.length,
        rulesFromShopify: shopifyRules.length,
        shopifyOrdersFetched: shopifyFetchedCount,
        shopifyOrdersSaved: shopifyInsertedCount,
        shopifyOrdersSavedSingleItem: shopifySavedSingleItem,
        shopifyOrdersSkippedNoProducts: shopifySkippedNoProducts,
        shopifySyncAttempted,
        shopifySyncError,
        authState,
        authError
      }
    });
    
  } catch (err) {
    console.error("TRAIN ERRORRRRRRRRRR:", err);
    return Response.json(
      { success: false, error: err.message }, 
      { status: 500 }
    );
  }
}
