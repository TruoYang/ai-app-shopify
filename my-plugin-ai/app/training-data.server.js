// Which orders a shop trains on: the training date window from ShopSettings, and CSV
// product codes translated to shop product keys through the CsvProduct matches.

import prisma from "./db.server";

// { from, to } dates for the shop's window, or nulls for "all time".
export async function getTrainingWindow(shop, now = new Date()) {
  const settings = await prisma.shopSettings.findUnique({ where: { shop } });
  if (!settings) return { from: null, to: null };
  if (settings.trainLastMonths) {
    const from = new Date(now);
    from.setMonth(from.getMonth() - settings.trainLastMonths);
    return { from, to: null };
  }
  return { from: settings.trainFrom, to: settings.trainTo };
}

// Orders of one source inside the window. With a window set, undated orders are left out.
// CSV orders that were also created on Shopify are left out: the Shopify copy is used instead.
export async function loadTrainingOrders(shop, source, window) {
  const dateFilter = window.from || window.to
    ? { orderDate: { ...(window.from ? { gte: window.from } : {}), ...(window.to ? { lte: window.to } : {}) } }
    : {};
  const orders = await prisma.orderHistory.findMany({
    where: { shop, source, ...dateFilter },
    select: { orderId: true, orderDate: true, productIds: true },
  });
  if (source !== "csv_import") return orders;
  const onShopify = await prisma.orderHistory.findMany({
    where: { shop, source: "shopify", csvOrderId: { not: null } },
    select: { csvOrderId: true },
  });
  if (onShopify.length === 0) return orders;
  const replaced = new Set(onShopify.map((row) => row.csvOrderId));
  return orders.filter((order) => !replaced.has(order.orderId));
}

/**
 * Replaces CSV product codes with the matched shop product keys and drops unmatched codes.
 * Shops that never matched anything (CSV codes equal to shop SKUs, older imports)
 * keep their codes unchanged.
 */
export async function mapCsvOrders(shop, orders) {
  const matches = await prisma.csvProduct.findMany({
    where: { shop, shopProductKey: { not: null } },
    select: { code: true, shopProductKey: true },
  });
  if (matches.length === 0) return { orders, matchedProducts: 0, droppedCodes: 0 };

  const keyByCode = new Map(matches.map((row) => [row.code, row.shopProductKey]));
  let droppedCodes = 0;
  const mapped = orders.map((order) => {
    let codes;
    try {
      codes = JSON.parse(order.productIds);
    } catch {
      return { ...order, productIds: "[]" };
    }
    const keys = codes.map((code) => keyByCode.get(String(code).trim())).filter(Boolean);
    droppedCodes += codes.length - keys.length;
    return { ...order, productIds: JSON.stringify([...new Set(keys)]) };
  });
  return { orders: mapped, matchedProducts: matches.length, droppedCodes };
}

/**
 * Orders used for training, as plain data for the Python trainer:
 * [{ id, date, items: [productKey, ...] }] with CSV codes matched and variant SKUs
 * mapped to product keys (toKey). Orders with fewer than one item are dropped.
 */
export async function buildTrainingDataset(shop, toKey = (sku) => sku) {
  const window = await getTrainingWindow(shop);
  const csv = await mapCsvOrders(shop, await loadTrainingOrders(shop, "csv_import", window));
  const shopify = await loadTrainingOrders(shop, "shopify", window);

  const orders = [...csv.orders, ...shopify].flatMap((order) => {
    let skus;
    try {
      skus = JSON.parse(order.productIds);
    } catch {
      return [];
    }
    const items = [...new Set(skus.map((sku) => toKey(String(sku).trim())).filter(Boolean))];
    return items.length ? [{ id: order.orderId, date: order.orderDate?.toISOString() ?? null, items }] : [];
  });

  return { shop, window, exportedAt: new Date().toISOString(), orders };
}

// Shopify orders created from a CSV order carry the tag "csv-demo" and the note
// "Imported from CSV order <invoice> ...". Returns the CSV row's orderId, or null.
export function csvOrderIdOf(tags, note) {
  const tagList = Array.isArray(tags) ? tags : String(tags ?? "").split(",").map((tag) => tag.trim());
  if (!tagList.includes("csv-demo")) return null;
  const match = /CSV order (\S+?)[\s.(]/.exec(`${note ?? ""} `);
  return match ? `csv_${match[1]}` : null;
}
