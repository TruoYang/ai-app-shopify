import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

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

export const loader = async ({ request }) => {
    // CORS headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const url = new URL(request.url);
        const shop = url.searchParams.get("shop");
        const cartIdsRaw = url.searchParams.get("ids"); // "123,456,789" (Shopify product IDs)
        const cartSkusRaw = url.searchParams.get("skus"); // "22747,22699" (SKUs from cart)

        if (!shop) {
            return new Response(JSON.stringify({ error: "Missing shop" }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // Get SKUs from request params
        const cartSkus = cartSkusRaw
            ? [...new Set(cartSkusRaw.split(",").map((sku) => sku.trim()).filter(Boolean))]
            : [];
        const cartIds = cartIdsRaw
            ? [...new Set(cartIdsRaw.split(",").map((id) => id.trim()).filter(Boolean))]
            : [];
        
        console.log("Cart SKUs:", cartSkus);
        console.log("Cart IDs:", cartIds);

        if (cartSkus.length === 0 && cartIds.length === 0) {
            return new Response(JSON.stringify({ error: "Missing ids or skus" }), {
                status: 400,
                headers: corsHeaders
            });
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
            return new Response(JSON.stringify({ 
                message: "No recommendation found for this cart",
                debug: { cartSkus, rulesCount: rules.length }
            }), { headers: corsHeaders });
        }

        const candidateSkus = candidates.map(({ rule }) => rule.suggestProduct);
        console.log(`Matched ${candidateSkus.length} recommendation candidates`);

        // Find product with SKU matching suggestProduct
        const { admin } = await unauthenticated.admin(shop);

        // Query product by SKU
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
            return new Response(JSON.stringify({ 
                message: "Suggested products were not found in this shop",
                suggestedSkus: candidateSkus,
            }), { headers: corsHeaders });
        }

        console.log(`Found ${products.length} products`);

        return new Response(JSON.stringify({
            product: products[0].product,
            confidence: products[0].confidence,
            basedOn: products[0].basedOn,
            products,
        }), { headers: corsHeaders });

    } catch (error) {
        console.error("API Error:", error);
        return new Response(JSON.stringify({ 
            error: true, 
            message: error.message 
        }), { 
            status: 500, 
            headers: corsHeaders 
        });
    }
};