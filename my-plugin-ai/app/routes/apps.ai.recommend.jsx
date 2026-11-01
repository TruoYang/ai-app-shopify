// Storefront recommendations through the Shopify app proxy.
//
// The widget calls /apps/ai/recommend on the shop's own domain; Shopify signs the
// request and forwards it here, so the widget never needs the app's tunnel URL.

import { authenticate } from "../shopify.server";
import { parseList, recommendForCart } from "../recommendations.server";

export const loader = async ({ request }) => {
    try {
        const { session, admin } = await authenticate.public.appProxy(request);

        if (!session || !admin) {
            return Response.json({ error: "App is not installed on this shop" }, { status: 404 });
        }

        const url = new URL(request.url);
        const { status, body } = await recommendForCart({
            shop: session.shop,
            admin,
            cartSkus: parseList(url.searchParams.get("skus")),
            cartIds: parseList(url.searchParams.get("ids")),
        });

        return Response.json(body, { status });
    } catch (error) {
        if (error instanceof Response) throw error;
        console.error("App proxy error:", error);
        return Response.json({ error: true, message: error.message }, { status: 500 });
    }
};
