/* eslint-env node */
// Create Shopify customers and orders from the CSV order history stored by the app, so the
// shop's admin (Orders, Customers, Analytics) shows a realistic history.
//
// - Takes the most recent CSV orders (OrderHistory, source csv_import) that have a customer and
//   at least one product matched to the shop (CsvProduct.shopProductKey).
// - One Shopify customer per CSV customer ID, tagged "uci-<id>" and "csv-demo". Names are
//   synthetic (about half Vietnamese, half international; gender follows what they bought);
//   emails use the reserved example.com domain, so nothing can be delivered.
// - Orders keep the original order date, are tagged "csv-demo", paid, and send no email.
//   Training skips csv-demo orders when syncing from Shopify (they are already CSV orders).
// - Re-running continues where it stopped (data/catalog/pushed-orders-<shop>.json).
//
// Usage (from my-plugin-ai/), after the app has the write_orders and write_customers scopes:
//   node --import ./scripts/lib/register-app-imports.mjs scripts/demo/push-demo-orders.mjs \
//     --shop my-favsion.myshopify.com [--count 300]

import fs from "fs";
import path from "path";
import prisma from "../../app/db.server.js";

const API_VERSION = "2025-10";
const MAX_ITEMS = 5;
const CATALOGS = ["data/catalog/fashion-catalog.json", "data/catalog/tstars/catalog.json"];

const VN = {
  family: ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"],
  Female: { middle: ["Thị", "Ngọc", "Thu", "Thanh", "Minh", "Bảo"], given: ["Anh", "Hà", "Linh", "Trang", "Hương", "Lan", "Mai", "Ngọc", "Thảo", "Vy", "Yến", "Hạnh", "Nhung", "Phương", "Quỳnh", "Chi"] },
  Male: { middle: ["Văn", "Minh", "Đức", "Quốc", "Hoàng", "Thanh"], given: ["An", "Bình", "Cường", "Dũng", "Hải", "Hiếu", "Hùng", "Khoa", "Long", "Minh", "Nam", "Phúc", "Quân", "Sơn", "Tuấn", "Huy"] },
};
const INTL = {
  family: ["Smith", "Jones", "Taylor", "Brown", "Williams", "Wilson", "Johnson", "Davies", "Evans", "Martin", "Müller", "Dubois", "Rossi", "García", "Kim", "Tanaka", "Wang", "Lee"],
  Female: ["Emma", "Olivia", "Sophie", "Charlotte", "Amelia", "Grace", "Hannah", "Lucy", "Chloe", "Isabella", "Mia", "Yuna"],
  Male: ["James", "Oliver", "Harry", "Jack", "George", "Thomas", "William", "Daniel", "Lucas", "Noah", "Kenji", "Leo"],
};

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
const pick = (list, seed) => list[hashString(seed) % list.length];
const ascii = (value) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9]+/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function syntheticName(customerId, gender) {
  if (hashString(`origin-${customerId}`) % 2 === 0) {
    const names = VN[gender];
    return {
      firstName: `${pick(names.middle, `m-${customerId}`)} ${pick(names.given, `g-${customerId}`)}`,
      lastName: pick(VN.family, `f-${customerId}`),
    };
  }
  return { firstName: pick(INTL[gender], `g-${customerId}`), lastName: pick(INTL.family, `f-${customerId}`) };
}

function parseArgs(argv) {
  const args = { count: 300 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shop") args.shop = argv[++i];
    else if (argv[i] === "--count") args.count = Number(argv[++i]);
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  if (!args.shop) throw new Error("--shop is required");
  return args;
}

async function main() {
  const { shop, count } = parseArgs(process.argv.slice(2));
  const session = await prisma.session.findFirst({ where: { shop, isOnline: false } });
  if (!session) throw new Error(`No offline session for ${shop}`);

  const graphql = async (query, variables) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      let response;
      try {
        response = await fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": session.accessToken },
          body: JSON.stringify({ query, variables }),
        });
      } catch {
        // Network hiccup: wait and retry.
        await sleep(3000 * (attempt + 1));
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      const json = await response.json();
      if (json.errors?.some((error) => error.extensions?.code === "THROTTLED")) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).join("; "));
      return json.data;
    }
    throw new Error("Shopify kept throttling");
  };

  // Shop product key -> variant ID, price and gender, from the seeding logs and catalogs.
  const products = new Map();
  for (const file of CATALOGS.filter((f) => fs.existsSync(f))) {
    for (const product of JSON.parse(fs.readFileSync(file, "utf8")).products) {
      products.set(product.baseSku, { handle: product.handle, gender: product.attributes.gender, price: product.variants[0].price });
    }
  }
  const seeded = JSON.parse(fs.readFileSync(path.join("data", "catalog", `seed-result-${shop}.json`), "utf8")).products;
  const variantsByHandle = new Map(seeded.map((entry) => [entry.handle, entry.variants]));

  const matches = await prisma.csvProduct.findMany({ where: { shop, shopProductKey: { not: null } }, select: { code: true, shopProductKey: true } });
  const keyByCode = new Map(matches.map((row) => [row.code, row.shopProductKey]));

  const logPath = path.join("data", "catalog", `pushed-orders-${shop}.json`);
  const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, "utf8")) : { customers: {}, orders: {} };
  const save = () => fs.writeFileSync(logPath, JSON.stringify(log, null, 2));

  // Most recent CSV orders with a customer and at least one matched product.
  const candidates = await prisma.orderHistory.findMany({
    where: { shop, source: "csv_import", customerId: { not: null } },
    orderBy: { orderDate: "desc" },
    take: count * 4,
  });
  const orders = [];
  for (const order of candidates) {
    const lines = JSON.parse(order.lines ?? "[]")
      .map((line) => ({ ...line, key: keyByCode.get(line.code) }))
      .filter((line) => line.key && products.has(line.key) && variantsByHandle.has(products.get(line.key).handle));
    if (lines.length) orders.push({ ...order, lines });
    if (orders.length >= count) break;
  }
  const todo = orders.filter((order) => !log.orders[order.orderId]).reverse(); // oldest first
  console.log(`${orders.length} orders selected, ${todo.length} to create`);

  for (const [index, order] of todo.entries()) {
    // Customer: created once per CSV customer ID.
    let customerGid = log.customers[order.customerId];
    if (!customerGid) {
      const genders = order.lines.map((line) => products.get(line.key).gender);
      const gender = genders.filter((g) => g === "Men").length > genders.filter((g) => g === "Women").length ? "Male" : "Female";
      const { firstName, lastName } = syntheticName(order.customerId, gender);
      const email = `${ascii(firstName)}.${ascii(lastName)}.${order.customerId}@example.com`;
      // Reuse a customer left by an earlier, interrupted run.
      const existing = await graphql(
        `query DemoCustomerByEmail($query: String!) { customers(first: 1, query: $query) { nodes { id } } }`,
        { query: `email:${email}` },
      );
      customerGid = existing.customers.nodes[0]?.id;
    }
    if (!customerGid) {
      const genders = order.lines.map((line) => products.get(line.key).gender);
      const gender = genders.filter((g) => g === "Men").length > genders.filter((g) => g === "Women").length ? "Male" : "Female";
      const { firstName, lastName } = syntheticName(order.customerId, gender);
      const data = await graphql(
        `mutation DemoCustomer($input: CustomerInput!) {
          customerCreate(input: $input) { customer { id } userErrors { field message } }
        }`,
        {
          input: {
            firstName,
            lastName,
            email: `${ascii(firstName)}.${ascii(lastName)}.${order.customerId}@example.com`,
            tags: [`uci-${order.customerId}`, "csv-demo"],
            note: `Synthetic demo customer for CSV customer ID ${order.customerId} (UCI Online Retail).`,
          },
        },
      );
      const errors = data.customerCreate.userErrors;
      if (errors.length) throw new Error(`Customer ${order.customerId}: ${errors.map((e) => e.message).join("; ")}`);
      customerGid = data.customerCreate.customer.id;
    }
    if (!log.customers[order.customerId]) {
      log.customers[order.customerId] = customerGid;
      save();
    }

    // Order: up to MAX_ITEMS matched shop products (the CSV is a wholesaler with large baskets),
    // one unit each, at today's shop prices. Training still uses the full CSV basket.
    const lineItems = order.lines.slice(0, MAX_ITEMS).map((line) => {
      const product = products.get(line.key);
      const variants = variantsByHandle.get(product.handle);
      const variant = variants[hashString(`${order.orderId}-${line.key}`) % variants.length];
      return {
        variantId: variant.id,
        quantity: 1,
        priceSet: { shopMoney: { amount: product.price.toFixed(2), currencyCode: "USD" } },
      };
    });
    const total = lineItems.reduce((sum, item) => sum + Number(item.priceSet.shopMoney.amount), 0);
    const invoice = order.orderId.replace(/^csv_/, "");

    for (let attempt = 0; ; attempt++) {
      const data = await graphql(
        `mutation DemoOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
          orderCreate(order: $order, options: $options) { order { id name } userErrors { field message } }
        }`,
        {
          order: {
            customer: { toAssociate: { id: customerGid } },
            lineItems,
            processedAt: order.orderDate?.toISOString(),
            financialStatus: "PAID",
            transactions: [{
              kind: "SALE",
              status: "SUCCESS",
              gateway: "manual",
              amountSet: { shopMoney: { amount: total.toFixed(2), currencyCode: "USD" } },
            }],
            tags: ["csv-demo"],
            note: `Imported from CSV order ${invoice} (UCI customer ${order.customerId}).`,
          },
          options: { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: "BYPASS" },
        },
      );
      const errors = data.orderCreate.userErrors;
      if (!errors.length) {
        log.orders[order.orderId] = data.orderCreate.order.id;
        save();
        console.log(`  [${index + 1}/${todo.length}] ${data.orderCreate.order.name} <- CSV ${invoice} (${lineItems.length} items)`);
        break;
      }
      const message = errors.map((e) => e.message).join("; ");
      // Development stores limit how many orders can be created per minute.
      if (/too many|limit|throttl|try again/i.test(message) && attempt < 10) {
        console.log(`  rate limited (${message}); waiting 60 s`);
        await sleep(60_000);
        continue;
      }
      throw new Error(`Order ${invoice}: ${message}`);
    }
  }

  console.log(`Done: ${Object.keys(log.orders).length} orders, ${Object.keys(log.customers).length} customers. Log: ${logPath}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await prisma.$disconnect();
  process.exit(1);
});
