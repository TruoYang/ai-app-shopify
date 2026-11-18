// Replay simulation of an A/B test (Phase 5).
//
// The demo shop has no real shoppers, so live A/B data would stay empty. The replay turns real
// held-out orders into simulated visits and sends each one through the real serving code
// (recommendForCart), split at random between the AI group and the best-seller control group:
//
//   1. Held-out orders: orders after the end of the training window, so the rules never saw
//      them. Without an end date, the newest 20% of orders are used and the result is flagged
//      as optimistic (those orders were also in the training data).
//   2. Each order becomes one visit: half of its products (max 5) are the cart, the rest are
//      "hidden" products the shopper really bought.
//   3. The widget shows the top DISPLAY suggestions. A simple shopper model decides clicks and
//      adds: hidden products are much more likely to be clicked; lower positions less so.
//   4. Events are written with simulated = true and read by the Insights dashboard, which runs
//      the same two-proportion z-test as for live data.
//
// The shopper model is an assumption (see SHOPPER_MODEL); the comparison between groups is
// fair because both groups use the same model and the same kind of orders.
// `aaTest` serves AI suggestions to both groups (A/A test): the z-test should then find no
// difference in about 95% of runs, which checks the measurement pipeline itself.

import prisma from "./db.server";
import { getShopCatalog, toProductKey } from "./catalog.server";
import { getTrainingWindow, loadTrainingOrders, mapCsvOrders } from "./training-data.server";
import { recommendForCart } from "./recommendations.server";
import { seededRandom } from "./ab-stats";

export const DISPLAY = 6; // the widget's default number of products
const MAX_CART = 5;
const HOLDOUT_SHARE = 0.2;
const MIN_HOLDOUT = 100;
const SPREAD_DAYS = 14; // simulated visits are spread over the last two weeks

export const SHOPPER_MODEL = {
  clickRelevant: 0.5, // chance to click a suggestion the shopper really bought (position 1)
  clickOther: 0.04, // chance to click any other suggestion (position 1)
  addAfterClickRelevant: 0.8,
  addAfterClickOther: 0.15,
  buyAddedOther: 0.3, // an added product that was not in the real order is bought
  // Without a suggestion, the shopper still finds each product of their real order on their
  // own with this chance; a product added from the widget is always bought.
  findWithoutHelp: 0.7,
  // Position weight 1 / log2(position + 1): position 1 = 1, position 2 = 0.63, position 6 = 0.36.
};

const positionWeight = (index) => 1 / Math.log2(index + 2);

function shuffle(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const parseKeys = (order, toKey) => {
  try {
    return JSON.parse(order.productIds).map((sku) => toKey(String(sku).trim()));
  } catch {
    return [];
  }
};

// Held-out orders as product-key baskets, plus where they came from.
async function loadHoldout(shop, catalog) {
  const window = await getTrainingWindow(shop);
  const toKey = (sku) => toProductKey(catalog, sku);
  const load = async (range) => {
    const csv = await mapCsvOrders(shop, await loadTrainingOrders(shop, "csv_import", range));
    const shopify = await loadTrainingOrders(shop, "shopify", range);
    return [...csv.orders.map((order) => ({ ...order, keys: parseKeys(order, (key) => key) })),
      ...shopify.map((order) => ({ ...order, keys: parseKeys(order, toKey) }))];
  };
  const basket = (order) => [...new Set(order.keys)].filter((key) => catalog.products.has(key));

  if (window.to) {
    const after = (await load({ from: new Date(window.to.getTime() + 1), to: null }))
      .map((order) => ({ date: order.orderDate, items: basket(order) }))
      .filter((order) => order.items.length >= 2);
    if (after.length >= MIN_HOLDOUT) return { baskets: after, overlap: false, window };
  }

  const all = (await load({ from: null, to: null }))
    .filter((order) => order.orderDate)
    .sort((a, b) => a.orderDate - b.orderDate);
  const newest = all.slice(Math.floor(all.length * (1 - HOLDOUT_SHARE)))
    .map((order) => ({ date: order.orderDate, items: basket(order) }))
    .filter((order) => order.items.length >= 2);
  return { baskets: newest, overlap: true, window };
}

/**
 * Runs the replay and replaces the shop's earlier simulated events.
 * Returns the run summary (also saved in ShopSettings.lastReplaySummary).
 */
export async function runReplay({ shop, admin, sessions = 2000, controlShare = 50, seed = 42, aaTest = false }) {
  const started = Date.now();
  const random = seededRandom(seed);
  const catalog = await getShopCatalog(shop, admin);
  const { baskets, overlap, window } = await loadHoldout(shop, catalog);
  if (baskets.length === 0) throw new Error("No orders with at least two matched shop products to replay.");

  const picked = shuffle(baskets, random).slice(0, Math.min(sessions, baskets.length));
  const rows = [];
  const now = Date.now();

  for (let i = 0; i < picked.length; i++) {
    const order = picked[i];
    const items = shuffle(order.items, random);
    const cartSize = Math.min(MAX_CART, Math.max(1, Math.floor(items.length / 2)));
    const cart = items.slice(0, cartSize);
    const hidden = new Set(items.slice(cartSize));
    const variant = random() * 100 < controlShare ? "control" : "ai";
    const visitorId = `sim-${seed}-${i}`;
    const createdAt = new Date(now - random() * SPREAD_DAYS * 86_400_000);
    const base = { shop, visitorId, variant, placement: "cart", simulated: true, createdAt };

    const served = aaTest ? "ai" : variant;
    const { body } = await recommendForCart({ shop, admin, cartSkus: cart, variant: served, quiet: true });
    const shown = (body.products ?? []).slice(0, DISPLAY);
    if (shown.length === 0) continue;
    rows.push({ ...base, type: "impression", items: JSON.stringify(shown.map((entry) => [entry.product.sku, entry.source])) });

    const priceOf = (key) => catalog.products.get(key)?.price ?? 0;
    // Baseline = the expected order of this visit without any widget: the cart, plus each hidden
    // product found alone (findWithoutHelp). Expected values are used instead of random draws, so
    // order size does not add noise; value - baseline is then the revenue the widget added.
    const cartValue = cart.reduce((sum, key) => sum + priceOf(key), 0);
    const hiddenValue = [...hidden].reduce((sum, key) => sum + priceOf(key), 0);
    const baseline = cartValue + SHOPPER_MODEL.findWithoutHelp * hiddenValue;
    const addedKeys = new Set();
    let extraOther = 0;
    let recValue = 0;
    shown.forEach((entry, index) => {
      const key = entry.product.sku;
      const relevant = hidden.has(key);
      const weight = positionWeight(index);
      const clickChance = (relevant ? SHOPPER_MODEL.clickRelevant : SHOPPER_MODEL.clickOther) * weight;
      if (random() >= clickChance) return;
      const event = { ...base, productKey: key, reason: entry.source };
      rows.push({ ...event, type: "click" });
      const addChance = relevant ? SHOPPER_MODEL.addAfterClickRelevant : SHOPPER_MODEL.addAfterClickOther;
      if (random() >= addChance) return;
      rows.push({ ...event, type: "add_to_cart" });
      const price = Number(entry.product.price);
      if (relevant) {
        recValue += price;
        addedKeys.add(key);
      } else if (random() < SHOPPER_MODEL.buyAddedOther) {
        recValue += price;
        extraOther += price;
      }
    });
    // The visit ends with an (expected) order: the cart, hidden products added from the widget
    // (always bought) or found alone (expected value), and other widget products bought.
    let value = cartValue + extraOther;
    for (const key of hidden) {
      value += addedKeys.has(key) ? priceOf(key) : SHOPPER_MODEL.findWithoutHelp * priceOf(key);
    }
    const round = (amount) => Math.round(amount * 100) / 100;
    rows.push({
      ...base,
      type: "purchase",
      value: round(value),
      recValue: round(recValue),
      items: JSON.stringify({ added: round(recValue), clicked: 0, baseline: round(baseline) }),
      orderId: `sim-order-${i}`,
    });
  }

  await prisma.recommendationEvent.deleteMany({ where: { shop, simulated: true } });
  for (let i = 0; i < rows.length; i += 500) {
    await prisma.recommendationEvent.createMany({ data: rows.slice(i, i + 500) });
  }

  const dates = picked.map((order) => order.date).filter(Boolean).sort((a, b) => a - b);
  const summary = {
    ranAt: new Date().toISOString(),
    sessions: picked.length,
    availableOrders: baskets.length,
    controlShare,
    seed,
    aaTest,
    overlap,
    trainingWindowEnd: window.to?.toISOString() ?? null,
    ordersFrom: dates[0]?.toISOString() ?? null,
    ordersTo: dates.at(-1)?.toISOString() ?? null,
    events: rows.length,
    seconds: Math.round((Date.now() - started) / 100) / 10,
  };
  await prisma.shopSettings.upsert({
    where: { shop },
    update: { lastReplaySummary: JSON.stringify(summary) },
    create: { shop, lastReplaySummary: JSON.stringify(summary) },
  });
  return summary;
}

export const clearSimulatedEvents = (shop) =>
  prisma.recommendationEvent.deleteMany({ where: { shop, simulated: true } });
