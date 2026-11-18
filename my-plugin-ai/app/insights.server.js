// Aggregates widget events for the Insights dashboard and the A/B test.
//
// Visitor-level metrics (one visitor = one anonymous widget id):
//   exposed   = visitors who saw the widget (at least one impression)
//   clickRate = exposed visitors who clicked a suggestion / exposed visitors
//   addRate   = exposed visitors who added a suggestion to the cart / exposed visitors
// Groups are compared with the two-proportion z-test (app/ab-stats.js).
//
// Revenue:
//   recRevenue      = revenue sold through the widget (added with its button, or clicked in it
//                     within 24 h before the order); split into addedRevenue / clickedRevenue
//   revenueUplift   = extra revenue caused by the AI: revenue per exposed visitor in the AI group
//                     minus the control group (all order value, not only suggested products),
//                     times the AI group's visitors, with a 95% interval (Welch, normal approx.)

import prisma from "./db.server";
import { meanDifferenceTest, meanVariance, sampleSizePerGroup, twoProportionZTest } from "./ab-stats";

const VARIANTS = ["ai", "control"];

const emptyGroup = (variant) => ({
  variant,
  visitors: 0,
  clickedVisitors: 0,
  addedVisitors: 0,
  impressions: 0,
  shownItems: 0,
  clicks: 0,
  adds: 0,
  orders: 0,
  orderValue: 0,
  recRevenue: 0,
  addedRevenue: 0,
  clickedRevenue: 0,
});

/**
 * Insights of one shop. `simulated` picks replay data (true) or live shopper data (false).
 * `days` limits to the last N days (null = all time); `since` is an extra lower bound
 * (start of the live experiment).
 */
export async function getInsights({ shop, simulated, days = 30, since = null }) {
  const bounds = [days ? new Date(Date.now() - days * 86_400_000) : null, since ? new Date(since) : null]
    .filter(Boolean);
  const from = bounds.length ? new Date(Math.max(...bounds.map(Number))) : null;
  const events = await prisma.recommendationEvent.findMany({
    where: { shop, simulated, ...(from ? { createdAt: { gte: from } } : {}) },
    select: { type: true, visitorId: true, variant: true, productKey: true, reason: true, items: true, value: true, recValue: true },
  });

  const groups = new Map(VARIANTS.map((variant) => [variant, emptyGroup(variant)]));
  const sets = new Map(VARIANTS.map((variant) => [variant, { seen: new Set(), clicked: new Set(), added: new Set(), revenue: new Map() }]));
  const reasons = new Map();
  const products = new Map();
  const reasonRow = (reason) => {
    const key = reason || "rule";
    if (!reasons.has(key)) reasons.set(key, { reason: key, shown: 0, clicks: 0, adds: 0 });
    return reasons.get(key);
  };
  const productRow = (key) => {
    if (!products.has(key)) products.set(key, { productKey: key, shown: 0, clicks: 0, adds: 0 });
    return products.get(key);
  };

  for (const event of events) {
    const variant = groups.has(event.variant) ? event.variant : "ai";
    const group = groups.get(variant);
    const visitorSets = sets.get(variant);
    if (event.type === "impression") {
      group.impressions++;
      visitorSets.seen.add(event.visitorId);
      let items = [];
      try {
        items = JSON.parse(event.items) ?? [];
      } catch {
        // Malformed row: counted as an impression without items.
      }
      group.shownItems += items.length;
      for (const [key, reason] of items) {
        reasonRow(reason).shown++;
        productRow(key).shown++;
      }
    } else if (event.type === "click") {
      group.clicks++;
      visitorSets.clicked.add(event.visitorId);
      reasonRow(event.reason).clicks++;
      if (event.productKey) productRow(event.productKey).clicks++;
    } else if (event.type === "add_to_cart") {
      group.adds++;
      visitorSets.added.add(event.visitorId);
      reasonRow(event.reason).adds++;
      if (event.productKey) productRow(event.productKey).adds++;
    } else if (event.type === "purchase") {
      group.orders++;
      group.orderValue += event.value ?? 0;
      group.recRevenue += event.recValue ?? 0;
      let split = null;
      try {
        split = event.items ? JSON.parse(event.items) : null;
      } catch {
        split = null;
      }
      // Older and simulated purchases have no split: everything was added with the widget.
      group.addedRevenue += split ? Number(split.added) || 0 : event.recValue ?? 0;
      group.clickedRevenue += split ? Number(split.clicked) || 0 : 0;
      // Replay orders carry their real order value as a baseline: comparing value - baseline
      // removes the large order-to-order noise (the replay knows what the shopper would buy).
      const baseline = Number(split?.baseline) || 0;
      if (split?.baseline != null) group.hasBaseline = true;
      visitorSets.revenue.set(event.visitorId, (visitorSets.revenue.get(event.visitorId) ?? 0) + (event.value ?? 0) - baseline);
    }
  }

  const result = [...groups.values()].map((group) => {
    const { seen, clicked, added, revenue } = sets.get(group.variant);
    const visitors = seen.size;
    // Only exposed visitors count as converted, so rates stay between 0 and 1.
    const clickedVisitors = [...clicked].filter((id) => seen.has(id)).length;
    const addedVisitors = [...added].filter((id) => seen.has(id)).length;
    // Revenue of every exposed visitor (0 without an order), for the uplift test.
    const revenueStats = meanVariance([...seen].map((id) => revenue.get(id) ?? 0));
    return {
      ...group,
      revenueStats,
      revenuePerVisitor: revenueStats.mean,
      visitors,
      clickedVisitors,
      addedVisitors,
      clickRate: visitors ? clickedVisitors / visitors : null,
      addRate: visitors ? addedVisitors / visitors : null,
      itemCtr: group.shownItems ? group.clicks / group.shownItems : null,
      recRevenuePerVisitor: visitors ? group.recRevenue / visitors : 0,
    };
  });
  const ai = result.find((group) => group.variant === "ai");
  const control = result.find((group) => group.variant === "control");

  const test = (convertedKey) => {
    const outcome = twoProportionZTest(control[convertedKey], control.visitors, ai[convertedKey], ai.visitors);
    if (!outcome) return null;
    return { ...outcome, neededPerGroup: sampleSizePerGroup(outcome.pA, outcome.pB) };
  };

  const revenueTest = meanDifferenceTest(control.revenueStats, ai.revenueStats);
  const revenueUplift = revenueTest ? {
    ...revenueTest,
    // true: replay data, revenue measured against each real order (value - baseline)
    vsBaseline: Boolean(ai.hasBaseline || control.hasBaseline),
    aiVisitors: ai.visitors,
    // Extra revenue the AI group brought compared with what best sellers would have made.
    extraRevenue: revenueTest.diff * ai.visitors,
    extraRevenueCi: revenueTest.ci95.map((bound) => bound * ai.visitors),
    // Visitors per group to detect this difference (5% two-sided, 80% power).
    neededPerGroup: revenueTest.diff ? Math.ceil(((1.959964 + 0.841621) ** 2 * (control.revenueStats.variance + ai.revenueStats.variance)) / revenueTest.diff ** 2) : null,
  } : null;

  const totals = result.reduce((sum, group) => {
    for (const key of ["visitors", "impressions", "shownItems", "clicks", "adds", "orders", "orderValue", "recRevenue", "addedRevenue", "clickedRevenue"]) {
      sum[key] = (sum[key] ?? 0) + group[key];
    }
    return sum;
  }, {});
  totals.itemCtr = totals.shownItems ? totals.clicks / totals.shownItems : null;
  totals.addRate = totals.visitors ? (ai.addedVisitors + control.addedVisitors) / totals.visitors : null;

  const rate = (row) => ({ ...row, ctr: row.shown ? row.clicks / row.shown : null, addRate: row.shown ? row.adds / row.shown : null });
  return {
    from: from?.toISOString() ?? null,
    events: events.length,
    totals,
    groups: result,
    tests: { click: test("clickedVisitors"), addToCart: test("addedVisitors") },
    revenueUplift,
    reasons: [...reasons.values()].map(rate).sort((a, b) => b.shown - a.shown),
    topProducts: [...products.values()]
      .filter((row) => row.clicks || row.adds)
      .map(rate)
      .sort((a, b) => b.adds - a.adds || b.clicks - a.clicks)
      .slice(0, 10),
  };
}
