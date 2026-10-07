// API to train recommendation model from orders in database

import { authenticate, unauthenticated } from "../shopify.server";
import { trainModelFromDb } from "../ai-logic";
import prisma from "../db.server";

export const action = async ({ request }) => {
  let shop = "my-ai-shop-test.myshopify.com"; // Default shop cho dev
  let admin = null;
  let authState = "unknown";
  let authError = null;
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  if (shopParam) {
    shop = shopParam;
  }
  
  try {
    // Authenticate admin
    const authResult = await authenticate.admin(request);
    
    // if Response redirect, break
    if (!(authResult instanceof Response)) {
      shop = authResult.session.shop;
      admin = authResult.admin;
      authState = "authenticated";
      console.log("Authenticated shop:", shop);
    } else {
      authState = "redirect";
      console.log("Auth returned redirect, will try unauthenticated admin if possible");
    }
  } catch (authErr) {
    if (authErr instanceof Response) {
      authState = "redirect";
      console.log("Auth returned redirect, will try unauthenticated admin if possible");
    } else {
      authState = "error";
      authError = authErr?.message || String(authErr);
      console.log("Auth failed, will try unauthenticated admin if possible:", authErr.message);
    }
  }

  let adminForSync = admin;

  if (!adminForSync && shopParam) {
    try {
      const unauth = await unauthenticated.admin(shopParam);
      adminForSync = unauth.admin;
      if (authState !== "authenticated") {
        authState = "unauthenticated";
      }
    } catch (unauthErr) {
      authState = "unauthenticated-error";
      authError = unauthErr?.message || String(unauthErr);
    }
  }

  try {
    // 1. Get orders from database (separate CSV vs Shopify sources)
    let csvOrders = await prisma.orderHistory.findMany({
      where: {
        OR: [
          { shop, source: "csv_import" },
          { shop: "imported-from-csv" },
        ],
      },
      select: { productIds: true },
    });

    let shopifyOrders = await prisma.orderHistory.findMany({
      where: {
        shop,
        source: "shopify",
      },
      select: { productIds: true },
    });

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
                orders(first: 100, after: $after, query: "status:any") {
                  edges {
                    cursor
                    node {
                      id
                      lineItems(first: 50) {
                        edges {
                          node {
                            sku
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
        
        // Save orders from Shopify to database
        let newOrdersCount = 0;
        let skippedNoProducts = 0;

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

          await prisma.orderHistory.upsert({
            where: { 
              shop_orderId: { shop, orderId: order.id }
            },
            update: { productIds: JSON.stringify(uniqueSkus) },
            create: {
              shop,
              orderId: order.id,
              productIds: JSON.stringify(uniqueSkus),
              source: "shopify"
            }
          });
          newOrdersCount++;
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
        csvOrders = await prisma.orderHistory.findMany({
          where: {
            OR: [
              { shop, source: "csv_import" },
              { shop: "imported-from-csv" },
            ],
          },
          select: { productIds: true },
        });

        shopifyOrders = await prisma.orderHistory.findMany({
          where: {
            shop,
            source: "shopify",
          },
          select: { productIds: true },
        });
        
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
    const csvRules = csvOrders.length > 0 ? trainModelFromDb(csvOrders, shop) : [];
    const shopifyRules = shopifyOrders.length > 0 ? trainModelFromDb(shopifyOrders, shop) : [];

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

    mergeRules(csvRules);
    mergeRules(shopifyRules);

    const rules = Array.from(mergedRulesMap.values());

    // 4. Save rules to database
      // delete old rules:
    await prisma.recommendationRule.deleteMany({ where: { shop } });
      // save new rules:
    if (rules.length > 0) {
      await prisma.recommendationRule.createMany({ data: rules });
    }
    
    console.log("TRAINED RULES (merged):", rules.length);

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
};