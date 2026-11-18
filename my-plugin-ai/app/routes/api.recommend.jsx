// Public recommendation endpoint (CORS), for local testing only. The storefront widget uses the
// signed app proxy route (apps.ai.recommend.jsx). This route trusts the ?shop parameter, so it
// is turned off in production: anyone could otherwise read another shop's suggestions.

import process from "node:process";
import { unauthenticated } from "../shopify.server";
import { parseList, recommendForCart } from "../recommendations.server";

export const loader = async ({ request }) => {
    // CORS headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    };

    if (process.env.NODE_ENV === "production") {
        return new Response(null, { status: 404 });
    }

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        const url = new URL(request.url);
        const shop = url.searchParams.get("shop");

        if (!shop) {
            return new Response(JSON.stringify({ error: "Missing shop" }), {
                status: 400,
                headers: corsHeaders
            });
        }

        const { admin } = await unauthenticated.admin(shop);
        const { status, body } = await recommendForCart({
            shop,
            admin,
            cartSkus: parseList(url.searchParams.get("skus")),
        });

        return new Response(JSON.stringify(body), { status, headers: corsHeaders });

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
