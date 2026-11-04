import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  // Note: Shopify will only deliver this webhook if the subscription exists
  // (configured in shopify.app.*.toml and applied via Shopify CLI deploy, or
  // registered via the Admin API using registerWebhooks()).

  console.log(`Received ${topic} webhook for ${shop}`);

  // Prefer the GraphQL gid so it matches the format used elsewhere in the app.
  const orderId = payload?.admin_graphql_api_id || (payload?.id ? `gid://shopify/Order/${payload.id}` : null);

  // For this app's training/recommendation, SKUs are the most consistent identifier.
  const skus = Array.isArray(payload?.line_items)
    ? payload.line_items
        .map((li) => li?.sku)
        .filter((sku) => typeof sku === "string" && sku.trim().length > 0)
    : [];

  // Keep only unique SKUs
  const uniqueSkus = [...new Set(skus)].sort();

  // Optional: store the best-effort timestamp
  const orderDateRaw = payload?.processed_at || payload?.paid_at || payload?.created_at;
  const orderDate = orderDateRaw ? new Date(orderDateRaw) : null;

  if (!orderId) {
    console.warn("orders/paid webhook missing order id; skipping");
    return new Response();
  }

  // Orders created from the CSV history are already stored as CSV orders.
  const tags = String(payload?.tags ?? "").split(",").map((tag) => tag.trim());
  if (tags.includes("csv-demo")) return new Response();

  const customerId = payload?.customer?.admin_graphql_api_id
    ?? (payload?.customer?.id ? `gid://shopify/Customer/${payload.customer.id}` : null);
  const lines = JSON.stringify((payload?.line_items ?? [])
    .filter((li) => typeof li?.sku === "string" && li.sku.trim())
    .map((li) => ({ code: li.sku.trim(), quantity: li.quantity, price: Number(li.price ?? 0) })));

  // Need at least 2 items to learn associations.
  if (uniqueSkus.length >= 2) {
    // Idempotency: OrderHistory has @@unique([shop, orderId])
    await db.orderHistory.upsert({
      where: {
        shop_orderId: { shop, orderId },
      },
      update: {
        productIds: JSON.stringify(uniqueSkus),
        source: "shopify",
        orderDate,
        customerId,
        lines,
      },
      create: {
        shop,
        orderId,
        productIds: JSON.stringify(uniqueSkus),
        source: "shopify",
        orderDate,
        customerId,
        lines,
      },
    });
  } else {
    console.log(`orders/paid: not enough SKUs to learn (count=${uniqueSkus.length})`);
  }

  return new Response();
};
