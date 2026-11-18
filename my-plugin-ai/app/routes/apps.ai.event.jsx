// Widget events through the Shopify app proxy: POST /apps/ai/event.
//
// Body (sent with navigator.sendBeacon, so it arrives as text): { vid, events: [...] }.
// Each event: { type: impression | click | add_to_cart, placement, items | productKey, reason }.

import { authenticate } from "../shopify.server";
import { recordWidgetEvents } from "../events.server";

const MAX_BODY_BYTES = 16 * 1024;

export const action = async ({ request }) => {
  try {
    const { session } = await authenticate.public.appProxy(request);
    if (!session) return new Response(null, { status: 404 });

    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const saved = await recordWidgetEvents(session.shop, body?.vid, body?.events);
    return Response.json({ saved });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Event proxy error:", error);
    return new Response(null, { status: 500 });
  }
};

export const loader = () => new Response(null, { status: 405 });
