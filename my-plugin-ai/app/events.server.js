// Widget events (impression, click, add to cart, purchase) and the A/B experiment settings.

import prisma from "./db.server";
import { assignVariant } from "./ab-stats";

export const EVENT_TYPES = ["impression", "click", "add_to_cart", "purchase"];
export const REASONS = ["rule", "same_category", "recent_orders", "best_seller", "new_arrival"];
const PLACEMENTS = ["cart", "product", "home"];
const MAX_EVENTS_PER_REQUEST = 25;
const MAX_ITEMS = 12;

const EXPERIMENT_TTL_MS = 30_000;
const experimentCache = new Map();

// { enabled, controlShare, startedAt } of the shop's A/B test (cached 30 s).
export async function getExperiment(shop) {
  const cached = experimentCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.experiment;
  const settings = await prisma.shopSettings.findUnique({
    where: { shop },
    select: { abEnabled: true, abControlShare: true, abStartedAt: true },
  });
  const experiment = {
    enabled: Boolean(settings?.abEnabled),
    controlShare: settings?.abControlShare ?? 50,
    startedAt: settings?.abStartedAt?.toISOString() ?? null,
  };
  experimentCache.set(shop, { experiment, expiresAt: Date.now() + EXPERIMENT_TTL_MS });
  return experiment;
}

export const clearExperimentCache = (shop) => experimentCache.delete(shop);

export async function variantFor(shop, visitorId) {
  return assignVariant(visitorId, await getExperiment(shop));
}

const VISITOR_ID = /^[A-Za-z0-9_-]{8,64}$/;
export const isVisitorId = (value) => typeof value === "string" && VISITOR_ID.test(value);

const shortText = (value, max = 120) =>
  typeof value === "string" && value.length > 0 && value.length <= max ? value : null;

/**
 * Validates events sent by the storefront widget. The group (variant) is recomputed on the
 * server from the visitor id, so a shopper cannot move themselves to the other group.
 */
export async function recordWidgetEvents(shop, visitorId, rawEvents) {
  if (!isVisitorId(visitorId) || !Array.isArray(rawEvents)) return 0;
  const variant = await variantFor(shop, visitorId);
  const rows = [];
  for (const raw of rawEvents.slice(0, MAX_EVENTS_PER_REQUEST)) {
    const type = raw?.type;
    // Purchases come only from the orders/paid webhook.
    if (!EVENT_TYPES.includes(type) || type === "purchase") continue;
    const row = {
      shop,
      type,
      visitorId,
      variant,
      placement: PLACEMENTS.includes(raw.placement) ? raw.placement : null,
    };
    if (type === "impression") {
      const items = Array.isArray(raw.items) ? raw.items.slice(0, MAX_ITEMS)
        .filter((item) => Array.isArray(item) && shortText(item[0]))
        .map(([key, reason]) => [key, REASONS.includes(reason) ? reason : "rule"]) : [];
      if (items.length === 0) continue;
      row.items = JSON.stringify(items);
    } else {
      row.productKey = shortText(raw.productKey);
      if (!row.productKey) continue;
      row.reason = REASONS.includes(raw.reason) ? raw.reason : "rule";
    }
    rows.push(row);
  }
  if (rows.length) await prisma.recommendationEvent.createMany({ data: rows });
  return rows.length;
}

// Names written by the widget into the cart, read back from the order in the webhook.
export const CART_ATTR_VISITOR = "_smartcart_visitor";
export const LINE_PROPERTY = "_smartcart_rcm";
export const CART_ATTR_CLICKED = "_smartcart_clicked"; // product ids clicked in the last 24 h

const attribute = (list, name) =>
  (Array.isArray(list) ? list.find((entry) => entry?.name === name)?.value : null) ?? null;

/**
 * Purchase event from an orders/paid webhook payload. Orders count only when the cart came
 * from a visitor who saw the widget (cart attribute) or holds lines sold through it.
 * A line is sold through the widget when it was added with the widget's button ("added"), or
 * its product was clicked in the widget during the last 24 hours ("clicked", like an
 * affiliate click). recValue is the sum of both; the split is kept in items as JSON.
 */
export async function recordPurchase(shop, payload, orderId) {
  const visitorAttr = attribute(payload?.note_attributes, CART_ATTR_VISITOR);
  const lines = Array.isArray(payload?.line_items) ? payload.line_items : [];
  const clicked = new Set(String(attribute(payload?.note_attributes, CART_ATTR_CLICKED) ?? "")
    .split(",").map((id) => id.trim()).filter(Boolean));
  const lineValue = (line) => Number(line.price ?? 0) * Number(line.quantity ?? 1);
  const addedLines = lines.filter((line) => attribute(line?.properties, LINE_PROPERTY));
  const clickedLines = lines.filter((line) => !attribute(line?.properties, LINE_PROPERTY) &&
    line?.product_id != null && clicked.has(String(line.product_id)));
  if (!isVisitorId(visitorAttr) && addedLines.length === 0 && clickedLines.length === 0) return false;

  const existing = await prisma.recommendationEvent.findFirst({
    where: { shop, type: "purchase", orderId, simulated: false },
    select: { id: true },
  });
  if (existing) return false;

  const visitorId = isVisitorId(visitorAttr) ? visitorAttr : `order-${String(orderId).split("/").pop()}`;
  const added = addedLines.reduce((sum, line) => sum + lineValue(line), 0);
  const fromClicks = clickedLines.reduce((sum, line) => sum + lineValue(line), 0);
  await prisma.recommendationEvent.create({
    data: {
      shop,
      type: "purchase",
      visitorId,
      variant: await variantFor(shop, visitorId),
      value: Number(payload?.current_total_price ?? payload?.total_price ?? 0),
      recValue: added + fromClicks,
      items: JSON.stringify({ added, clicked: fromClicks }),
      orderId,
    },
  });
  return true;
}

const INTERACTION_TTL_MS = 10 * 60_000;
const INTERACTION_DAYS = 90;
const interactionCache = new Map();

/**
 * Live shopper interest per suggested product over the last 90 days:
 * a click counts 1, an add to cart 3. Used by the "interaction" ranking priority.
 */
export async function getInteractionScores(shop) {
  const cached = interactionCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.scores;
  const since = new Date(Date.now() - INTERACTION_DAYS * 86_400_000);
  const grouped = await prisma.recommendationEvent.groupBy({
    by: ["productKey", "type"],
    where: { shop, simulated: false, type: { in: ["click", "add_to_cart"] }, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const scores = new Map();
  for (const row of grouped) {
    if (!row.productKey) continue;
    const weight = row.type === "add_to_cart" ? 3 : 1;
    scores.set(row.productKey, (scores.get(row.productKey) ?? 0) + weight * row._count._all);
  }
  interactionCache.set(shop, { scores, expiresAt: Date.now() + INTERACTION_TTL_MS });
  return scores;
}
