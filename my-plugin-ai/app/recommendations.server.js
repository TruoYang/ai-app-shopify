// Shared recommendation logic for the public API route and the app proxy route.
//
// Every cart item gets its own suggestions (1-1), with fewer per item as the cart grows.
// Rules whose whole antecedent is in the cart (A + B -> D) get a bonus and go first.
// All SKUs are compared as product keys, so sizes of the same product count as one item.

import prisma from "./db.server";
import { getShopCatalog, toProductKey } from "./catalog.server";

const RULE_CACHE_TTL_MS = 30_000;
const MAX_RECOMMENDATIONS = 8;
const COMBINED_RULE_BONUS = 0.15;
const ruleCache = new Map();

// Suggestions per cart item: 1 item -> 5, 2 -> 3 each, 3-4 -> 2 each, 5+ -> 1 each.
export function perItemQuota(cartSize) {
    if (cartSize <= 1) return 5;
    if (cartSize === 2) return 3;
    if (cartSize <= 4) return 2;
    return 1;
}

const ruleScore = (rule) =>
    rule.confidence * 0.7 +
    Math.min(rule.support / 100, 1) * 0.2 +
    rule.priority * 0.01 +
    (rule.cart.length > 1 ? COMBINED_RULE_BONUS : 0);

// Active rules of a shop, with SKUs converted to product keys and indexed for lookup.
async function getShopRules(shop, catalog) {
    const cached = ruleCache.get(shop);
    if (cached && cached.expiresAt > Date.now() && cached.catalog === catalog) return cached.index;

    const storedRules = await prisma.recommendationRule.findMany({
        where: { shop, status: "active" },
        select: {
            cartProducts: true,
            suggestProduct: true,
            confidence: true,
            support: true,
            priority: true,
            discountPercent: true,
        },
    });

    const single = new Map();
    const combined = [];
    for (const stored of storedRules) {
        let cart;
        try {
            cart = JSON.parse(stored.cartProducts);
        } catch {
            continue;
        }
        if (!Array.isArray(cart) || cart.length === 0) continue;

        const keys = [...new Set(cart.map((sku) => toProductKey(catalog, String(sku).trim())).filter(Boolean))];
        const suggest = toProductKey(catalog, stored.suggestProduct.trim());
        if (keys.includes(suggest)) continue;

        const rule = { ...stored, cart: keys, suggest };
        rule.score = ruleScore(rule);
        if (keys.length === 1) {
            if (!single.has(keys[0])) single.set(keys[0], []);
            single.get(keys[0]).push(rule);
        } else {
            combined.push(rule);
        }
    }
    single.forEach((rules) => rules.sort((a, b) => b.score - a.score));
    combined.sort((a, b) => b.score - a.score);

    const index = { single, combined, count: storedRules.length };
    ruleCache.set(shop, { index, catalog, expiresAt: Date.now() + RULE_CACHE_TTL_MS });
    return index;
}

const POPULARITY_TTL_MS = 10 * 60_000;
const RECENT_ORDERS = 30;
const MIN_RECOMMENDATIONS = 4;
const popularityCache = new Map();

// Order-based signals for fallbacks: product keys by purchase count and by recency.
async function getOrderSignals(shop, catalog) {
    const cached = popularityCache.get(shop);
    if (cached && cached.expiresAt > Date.now() && cached.catalog === catalog) return cached.signals;

    const orders = await prisma.orderHistory.findMany({
        where: { shop },
        select: { productIds: true },
        orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
    });

    const counts = new Map();
    const recent = [];
    orders.forEach((order, index) => {
        let skus;
        try {
            skus = JSON.parse(order.productIds);
        } catch {
            return;
        }
        for (const key of new Set(skus.map((sku) => toProductKey(catalog, String(sku).trim())))) {
            if (!catalog.products.has(key)) continue;
            counts.set(key, (counts.get(key) ?? 0) + 1);
            if (index < RECENT_ORDERS && !recent.includes(key)) recent.push(key);
        }
    });

    const bestSellers = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
    const signals = { bestSellers, recent };
    popularityCache.set(shop, { signals, catalog, expiresAt: Date.now() + POPULARITY_TTL_MS });
    return signals;
}

const fallbackResult = (product, reason, forItem = null) => ({
    ...toResult(product, { confidence: null, discountPercent: null, cart: [] }, forItem),
    source: reason,
});

// Fills `chosen` up to `target` items: same product type as the cart, then products from
// the latest orders, then best sellers, then the newest products.
async function addFallbacks({ shop, catalog, cartKeys, cartSet, chosen, target }) {
    const add = (product, reason, forItem) => {
        if (chosen.size >= target || !product?.available) return;
        if (chosen.has(product.key) || cartSet.has(product.key)) return;
        chosen.set(product.key, fallbackResult(product, reason, forItem));
    };
    const all = [...catalog.products.values()];
    const { bestSellers, recent } = await getOrderSignals(shop, catalog);
    const rank = new Map(bestSellers.map((key, index) => [key, index]));
    const byPopularity = (a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity) ||
        String(b.createdAt).localeCompare(String(a.createdAt));

    for (const key of cartKeys) {
        const type = catalog.products.get(key)?.productType;
        if (!type) continue;
        all.filter((product) => product.productType === type).sort(byPopularity).slice(0, 2)
            .forEach((product) => add(product, "same_category", key));
    }
    recent.forEach((key) => add(catalog.products.get(key), "recent_orders"));
    bestSellers.forEach((key) => add(catalog.products.get(key), "best_seller"));
    all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .forEach((product) => add(product, "new_arrival"));
}

const RANK_BONUS = 0.15;
const settingsCache = new Map();

async function getRankBy(shop) {
    const cached = settingsCache.get(shop);
    if (cached && cached.expiresAt > Date.now()) return cached.rankBy;
    const settings = await prisma.shopSettings.findUnique({ where: { shop }, select: { rankBy: true } });
    const rankBy = settings?.rankBy ?? "balanced";
    settingsCache.set(shop, { rankBy, expiresAt: Date.now() + 60_000 });
    return rankBy;
}

/**
 * Extra score (0..RANK_BONUS) per suggested product for the merchant's priority:
 * revenue favours higher prices, quantity favours best sellers. "interaction" uses best
 * sellers until widget click tracking exists (Phase 5). "balanced" adds nothing.
 */
async function makeRankBonus(shop, catalog, rankBy) {
    if (rankBy === "balanced") return () => 0;
    if (rankBy === "revenue") {
        const maxPrice = Math.max(...[...catalog.products.values()].map((product) => product.price), 1);
        return (key) => RANK_BONUS * ((catalog.products.get(key)?.price ?? 0) / maxPrice);
    }
    const { bestSellers } = await getOrderSignals(shop, catalog);
    const rank = new Map(bestSellers.map((key, index) => [key, index]));
    const size = Math.max(bestSellers.length, 1);
    return (key) => (rank.has(key) ? RANK_BONUS * (1 - rank.get(key) / size) : 0);
}

const rankRules = (rules, bonus) =>
    bonus.isZero ? rules : [...rules].sort((a, b) => b.score + bonus(b.suggest) - (a.score + bonus(a.suggest)));

export const parseList = (raw) =>
    raw ? [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))] : [];

const toResult = (product, rule, forItem) => ({
    product: {
        id: product.id,
        title: product.title,
        image: product.image,
        price: product.price.toFixed(2),
        compareAtPrice: product.compareAtPrice ? product.compareAtPrice.toFixed(2) : null,
        currency: product.currency,
        url: product.url,
        variantId: product.variantId,
        sku: product.key,
        productType: product.productType,
    },
    confidence: rule.confidence,
    discountPercent: rule.discountPercent,
    basedOn: rule.cart,
    forItem,
    source: "rule",
});

/**
 * Returns { status, body } for the cart SKUs of one shop.
 * `admin` is an Admin API client for that shop.
 */
// An empty cart (home page) gets fallbacks only: recent orders, best sellers, new arrivals.
export async function recommendForCart({ shop, admin, cartSkus }) {
    const catalog = await getShopCatalog(shop, admin);
    const rules = await getShopRules(shop, catalog);
    const cartKeys = [...new Set(cartSkus.map((sku) => toProductKey(catalog, sku)))];
    const cartSet = new Set(cartKeys);
    const quota = perItemQuota(cartKeys.length);
    const rankBy = await getRankBy(shop);
    const bonus = await makeRankBonus(shop, catalog, rankBy);
    bonus.isZero = rankBy === "balanced";

    const chosen = new Map();
    const take = (rule, forItem) => {
        if (chosen.has(rule.suggest) || cartSet.has(rule.suggest)) return false;
        const product = catalog.products.get(rule.suggest);
        if (!product || !product.available) return false;
        chosen.set(rule.suggest, toResult(product, rule, forItem));
        return true;
    };

    // Combined rules first: they describe the cart as a whole.
    let combinedTaken = 0;
    for (const rule of rankRules(rules.combined, bonus)) {
        if (combinedTaken >= quota) break;
        if (rule.cart.every((key) => cartSet.has(key)) && take(rule, rule.cart.join("+"))) combinedTaken++;
    }

    // Then each cart item gets its own suggestions, in cart order.
    for (const key of cartKeys) {
        let taken = 0;
        for (const rule of rankRules(rules.single.get(key) ?? [], bonus)) {
            if (taken >= quota) break;
            if (take(rule, key)) taken++;
        }
    }

    const target = cartKeys.length === 0 ? MAX_RECOMMENDATIONS : MIN_RECOMMENDATIONS;
    if (chosen.size < target) {
        await addFallbacks({ shop, catalog, cartKeys, cartSet, chosen, target });
    }

    const products = [...chosen.values()].slice(0, MAX_RECOMMENDATIONS);
    console.log(`Recommend ${shop}: cart=${cartKeys.join(",")} rules=${rules.count} -> ${products.length}`);

    if (products.length === 0) {
        return {
            status: 200,
            body: {
                message: "No recommendation found for this cart",
                cartKeys,
                products: [],
                debug: { rulesCount: rules.count },
            },
        };
    }

    return {
        status: 200,
        body: {
            product: products[0].product,
            confidence: products[0].confidence,
            basedOn: products[0].basedOn,
            products,
            // Product keys of the cart, so the widget can drop kept suggestions already in it.
            cartKeys,
        },
    };
}
