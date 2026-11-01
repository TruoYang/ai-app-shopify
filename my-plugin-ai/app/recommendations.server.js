// Shared recommendation logic for the public API route and the app proxy route.

import prisma from "./db.server";

const RULE_CACHE_TTL_MS = 30_000;
const ruleCache = new Map();

async function getShopRules(shop) {
    const cached = ruleCache.get(shop);
    if (cached && cached.expiresAt > Date.now()) return cached.rules;

    const storedRules = await prisma.recommendationRule.findMany({
        where: { shop, status: "active" },
        select: {
            cartProducts: true,
            cartSize: true,
            suggestProduct: true,
            confidence: true,
            support: true,
            priority: true,
            discountPercent: true,
        },
        orderBy: [
            { cartSize: "desc" },
            { confidence: "desc" },
            { support: "desc" },
        ],
    });

    const rules = storedRules.flatMap((rule) => {
        try {
            const cart = JSON.parse(rule.cartProducts);
            if (!Array.isArray(cart) || cart.length === 0) return [];

            return [{
                ...rule,
                cart: cart.map((item) => String(item).trim()).filter(Boolean),
            }];
        } catch {
            return [];
        }
    });

    ruleCache.set(shop, { rules, expiresAt: Date.now() + RULE_CACHE_TTL_MS });
    return rules;
}

export const parseList = (raw) =>
    raw ? [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))] : [];

/**
 * Returns { status, body } for the cart SKUs of one shop.
 * `admin` is an Admin API client for that shop, used to look up the suggested products.
 */
export async function recommendForCart({ shop, admin, cartSkus, cartIds = [] }) {
    console.log("Cart SKUs:", cartSkus);
    console.log("Cart IDs:", cartIds);

    if (cartSkus.length === 0 && cartIds.length === 0) {
        return { status: 400, body: { error: "Missing ids or skus" } };
    }

    const rules = await getShopRules(shop);
    console.log(`Found ${rules.length} rules in database`);

    const cartSkuSet = new Set(cartSkus);
    const candidateMap = new Map();

    for (const rule of rules) {
        const isMatch = rule.cart.every((sku) => cartSkuSet.has(sku));
        if (!isMatch || cartSkuSet.has(rule.suggestProduct)) continue;

        const score =
            rule.confidence * 0.7 +
            Math.min(rule.support / 100, 1) * 0.2 +
            Math.min(rule.cart.length / Math.max(cartSkuSet.size, 1), 1) * 0.1 +
            rule.priority * 0.01;
        const previous = candidateMap.get(rule.suggestProduct);

        if (!previous || score > previous.score) {
            candidateMap.set(rule.suggestProduct, {
                rule,
                score,
            });
        }
    }

    const candidates = Array.from(candidateMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

    if (candidates.length === 0) {
        console.log("No matching rule found");
        return {
            status: 200,
            body: {
                message: "No recommendation found for this cart",
                debug: { cartSkus, rulesCount: rules.length },
            },
        };
    }

    const candidateSkus = candidates.map(({ rule }) => rule.suggestProduct);
    console.log(`Matched ${candidateSkus.length} recommendation candidates`);

    // Query products by SKU
    const query = `
        query getProductBySKU($sku: String!) {
            products(first: 10, query: $sku) {
                edges {
                    node {
                        id
                        title
                        handle
                        featuredImage { url }
                        priceRangeV2 {
                            minVariantPrice {
                                amount
                                currencyCode
                            }
                        }
                        variants(first: 1) {
                            edges {
                                node {
                                    id
                                    sku
                                }
                            }
                        }
                    }
                }
            }
        }
    `;

    const response = await admin.graphql(query, {
        variables: { sku: candidateSkus.map((sku) => `sku:${sku}`).join(" OR ") }
    });
    const responseJson = await response.json();
    const productsBySku = new Map();
    for (const edge of responseJson.data?.products?.edges ?? []) {
        const product = edge?.node;
        const sku = product?.variants?.edges?.[0]?.node?.sku;
        if (product && sku) productsBySku.set(sku, product);
    }
    const products = candidates.flatMap(({ rule }) => {
        const product = productsBySku.get(rule.suggestProduct);
        if (!product) return [];

        return [{
            product: {
                id: product.id,
                title: product.title,
                image: product.featuredImage?.url,
                price: product.priceRangeV2.minVariantPrice.amount,
                currency: product.priceRangeV2.minVariantPrice.currencyCode,
                url: `/products/${product.handle}`,
                variantId: product.variants.edges[0]?.node.id,
                sku: product.variants.edges[0]?.node.sku,
            },
            confidence: rule.confidence,
            discountPercent: rule.discountPercent,
            basedOn: rule.cart,
        }];
    });

    if (products.length === 0) {
        console.log(`No candidate products found for SKUs: ${candidateSkus.join(", ")}`);
        return {
            status: 200,
            body: {
                message: "Suggested products were not found in this shop",
                suggestedSkus: candidateSkus,
            },
        };
    }

    console.log(`Found ${products.length} products`);

    return {
        status: 200,
        body: {
            product: products[0].product,
            confidence: products[0].confidence,
            basedOn: products[0].basedOn,
            products,
        },
    };
}
