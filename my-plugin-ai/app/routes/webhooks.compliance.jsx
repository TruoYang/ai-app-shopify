// Mandatory GDPR / privacy webhooks (customers/data_request, customers/redact, shop/redact).
//
// What the app stores about customers: the Shopify customer id on synced orders
// (OrderHistory.customerId) and the order id on purchase events. Widget events use an anonymous
// browser id, never a name, email or address.

import { authenticate } from "../shopify.server";
import db from "../db.server";

const customerGid = (id) => (id ? `gid://shopify/Customer/${id}` : null);
const orderGid = (id) => `gid://shopify/Order/${id}`;

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const name = String(topic).toLowerCase().replace("_", "/");
  console.log(`Received ${name} webhook for ${shop}`);

  if (name === "customers/data_request") {
    // Report what is stored so the merchant can answer the customer.
    const customerId = customerGid(payload?.customer?.id);
    const orders = customerId ? await db.orderHistory.count({ where: { shop, customerId } }) : 0;
    console.log(`Data request for ${customerId}: ${orders} stored orders (product SKUs, dates, customer id). No contact details are stored.`);
  } else if (name === "customers/redact") {
    const customerId = customerGid(payload?.customer?.id);
    const orderIds = (payload?.orders_to_redact ?? []).map(orderGid);
    // Orders stay for training (they hold only products), unlinked from the customer.
    if (customerId) {
      await db.orderHistory.updateMany({ where: { shop, customerId }, data: { customerId: null } });
    }
    if (orderIds.length) {
      await db.orderHistory.updateMany({ where: { shop, orderId: { in: orderIds } }, data: { customerId: null } });
      await db.recommendationEvent.updateMany({ where: { shop, orderId: { in: orderIds } }, data: { orderId: null } });
    }
  } else if (name === "shop/redact") {
    // 48 hours after uninstall: delete everything the app stored for this shop.
    await db.$transaction([
      db.recommendationEvent.deleteMany({ where: { shop } }),
      db.recommendationRule.deleteMany({ where: { shop } }),
      db.orderHistory.deleteMany({ where: { shop } }),
      db.csvProduct.deleteMany({ where: { shop } }),
      db.csvImport.deleteMany({ where: { shop } }),
      db.shopSettings.deleteMany({ where: { shop } }),
      db.session.deleteMany({ where: { shop } }),
    ]);
  }

  return new Response();
};
