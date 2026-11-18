// Storefront recommendations through the Shopify app proxy.
//
// The widget calls /apps/ai/recommend on the shop's own domain; Shopify signs the
// request and forwards it here, so the widget never needs the app's tunnel URL.
// `vid` is the widget's anonymous visitor id: it decides the A/B group (ai or control).

import { authenticate } from "../shopify.server";
import { parseList, recommendForCart } from "../recommendations.server";
import { isVisitorId, variantFor } from "../events.server";

export const loader = async ({ request }) => {
    try {
        const { session, admin } = await authenticate.public.appProxy(request);

        if (!session || !admin) {
            return Response.json({ error: "App is not installed on this shop" }, { status: 404 });
        }

        const url = new URL(request.url);
        const visitorId = url.searchParams.get("vid");
        const variant = isVisitorId(visitorId) ? await variantFor(session.shop, visitorId) : "ai";
        const { status, body } = await recommendForCart({
            shop: session.shop,
            admin,
            cartSkus: parseList(url.searchParams.get("skus")),
            variant,
        });

        return Response.json(body, { status });
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("App proxy error:", error);
        return Response.json({ error: true, message: error.message }, { status: 500 });
    }
};
