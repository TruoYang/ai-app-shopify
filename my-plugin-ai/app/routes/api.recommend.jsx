import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

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
        const cartSkus = cartSkusRaw ? cartSkusRaw.split(",").filter(Boolean) : [];
        const cartIds = cartIdsRaw ? cartIdsRaw.split(",").filter(Boolean) : [];
        
        console.log("Cart SKUs:", cartSkus);
        console.log("Cart IDs:", cartIds);

        if (cartSkus.length === 0 && cartIds.length === 0) {
            return new Response(JSON.stringify({ error: "Missing ids or skus" }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // Find rules - for current shop OR from CSV import
        const rules = await prisma.recommendationRule.findMany({
            where: { 
                OR: [
                    { shop },
                    { shop: 'my-ai-shop-test.myshopify.com' } // default shop from train
                ]
            },
            orderBy: [
                { cartSize: 'desc' },
                { confidence: 'desc' }
            ]
        });

        console.log(`Found ${rules.length} rules in database`);

        // Find rule match for current cart (using SKU to match)
        let matchedRule = null;
        const cartSkuSet = new Set(cartSkus);

        for (const rule of rules) {
            const ruleCart = JSON.parse(rule.cartProducts); // ["22747"] or ["22697", "22699"]
            
            // Check if all SKUs in rule are in the cart
            const isMatch = ruleCart.every(sku => cartSkuSet.has(sku));
            
            // And suggested product is not in the cart
            if (isMatch && !cartSkuSet.has(rule.suggestProduct)) {
                matchedRule = rule;
                break; // Take the first matching rule
            }
        }

        if (!matchedRule) {
            console.log("No matching rule found");
            return new Response(JSON.stringify({ 
                message: "No recommendation found for this cart",
                debug: { cartSkus, rulesCount: rules.length }
            }), { headers: corsHeaders });
        }

        console.log(`Matched rule: Cart[${matchedRule.cartSize}] -> suggest SKU "${matchedRule.suggestProduct}" (${(matchedRule.confidence * 100).toFixed(1)}%)`);

        // Find product with SKU matching suggestProduct
        const { admin } = await unauthenticated.admin(shop);

        // Query product by SKU
        const query = `
            query getProductBySKU($sku: String!) {
                products(first: 1, query: $sku) {
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
            variables: { sku: `sku:${matchedRule.suggestProduct}` }
        });
        const responseJson = await response.json();
        const product = responseJson.data?.products?.edges?.[0]?.node;

        if (!product) {
            console.log(`Product with SKU "${matchedRule.suggestProduct}" not found in shop`);
            return new Response(JSON.stringify({ 
                message: "Suggested product not found. Create a product with SKU: " + matchedRule.suggestProduct,
                suggestedSku: matchedRule.suggestProduct
            }), { headers: corsHeaders });
        }

        console.log(`Found product: ${product.title}`);

        return new Response(JSON.stringify({
            product: {
                id: product.id,
                title: product.title,
                image: product.featuredImage?.url,
                price: product.priceRangeV2.minVariantPrice.amount,
                currency: product.priceRangeV2.minVariantPrice.currencyCode,
                url: `/products/${product.handle}`,
                variantId: product.variants.edges[0]?.node.id,
                sku: product.variants.edges[0]?.node.sku
            },
            confidence: matchedRule.confidence,
            basedOn: JSON.parse(matchedRule.cartProducts)
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