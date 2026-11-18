// Real checkout discounts for rules with a discount percentage (Phase 6).
//
// One automatic app discount ("SmartCart bundle discount") runs the Discount Function in
// extensions/smartcart-discount. Its metafield ($app:smartcart / discount-rules) holds the
// active discounted rules as numeric product ids:
//   { "rules": [{ "when": [111, 222], "product": 333, "percent": 10 }] }
// syncDiscounts() rebuilds that list from the database and creates the discount the first time.
// Call it after any change to rules (Rules page, training).

import prisma from "./db.server";
import { getShopCatalog, toProductKey } from "./catalog.server";

export const DISCOUNT_TITLE = "SmartCart bundle discount";
const NAMESPACE = "$app:smartcart";
const KEY = "discount-rules";
// Shopify limits metafield values read by a function, so the list stops below ~9.5 KB.
const MAX_CONFIG_BYTES = 9_500;

const numericId = (gid) => Number(String(gid).split("/").pop());

async function graphql(admin, query, variables) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) throw new Error(json.errors.map((error) => error.message).join("; "));
  return json.data;
}

// Rules with a discount, as product ids the function can compare with cart lines.
export async function buildDiscountRules(shop, catalog) {
  const rules = await prisma.recommendationRule.findMany({
    where: { shop, status: "active", discountPercent: { gt: 0 } },
    orderBy: [{ discountPercent: "desc" }, { updatedAt: "desc" }],
    select: { cartProducts: true, suggestProduct: true, discountPercent: true },
  });
  const productId = (sku) => {
    const product = catalog.products.get(toProductKey(catalog, String(sku).trim()));
    return product ? numericId(product.id) : null;
  };
  const seen = new Set();
  const out = [];
  let bytes = 12; // {"rules":[]}
  for (const rule of rules) {
    let cart;
    try {
      cart = JSON.parse(rule.cartProducts);
    } catch {
      continue;
    }
    const when = [...new Set(cart.map(productId))];
    const product = productId(rule.suggestProduct);
    if (!product || when.length === 0 || when.some((id) => !id || id === product)) continue;
    const signature = `${when.sort().join("+")}>${product}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    const entry = { when, product, percent: Math.min(Math.round(rule.discountPercent * 100) / 100, 90) };
    bytes += JSON.stringify(entry).length + 1;
    if (bytes > MAX_CONFIG_BYTES) break; // highest discounts come first
    out.push(entry);
  }
  return out;
}

const FUNCTIONS_QUERY = `#graphql
  query SmartCartFunctions {
    shopifyFunctions(first: 25) { nodes { id title apiType } }
  }`;
const FIND_DISCOUNT_QUERY = `#graphql
  query SmartCartDiscount($query: String!) {
    discountNodes(first: 5, query: $query) {
      nodes { id discount { __typename ... on DiscountAutomaticApp { title status } } }
    }
  }`;
const CREATE_MUTATION = `#graphql
  mutation SmartCartDiscountCreate($discount: DiscountAutomaticAppInput!) {
    discountAutomaticAppCreate(automaticAppDiscount: $discount) {
      automaticAppDiscount { discountId }
      userErrors { field message }
    }
  }`;
const METAFIELDS_MUTATION = `#graphql
  mutation SmartCartDiscountRules($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { userErrors { field message } }
  }`;

async function findDiscountId(admin) {
  const data = await graphql(admin, FIND_DISCOUNT_QUERY, { query: `title:'${DISCOUNT_TITLE}'` });
  const node = data.discountNodes.nodes.find(
    (entry) => entry.discount?.__typename === "DiscountAutomaticApp" && entry.discount.title === DISCOUNT_TITLE,
  );
  return node?.id ?? null;
}

/**
 * Writes the shop's discounted rules to the automatic discount, creating it if needed.
 * Returns { rules, discountId, created }. With no discounted rules and no discount yet,
 * nothing is created.
 */
export async function syncDiscounts(shop, admin) {
  const catalog = await getShopCatalog(shop, admin);
  const rules = await buildDiscountRules(shop, catalog);
  const value = JSON.stringify({ rules });
  let discountId = await findDiscountId(admin);

  if (!discountId) {
    if (rules.length === 0) return { rules: 0, discountId: null, created: false };
    const functions = await graphql(admin, FUNCTIONS_QUERY);
    const fn = functions.shopifyFunctions.nodes.find((node) => /discount/i.test(node.apiType));
    if (!fn) throw new Error("Discount function not found. Run shopify app dev or deploy the app first.");
    const data = await graphql(admin, CREATE_MUTATION, {
      discount: {
        title: DISCOUNT_TITLE,
        functionId: fn.id,
        discountClasses: ["PRODUCT"],
        startsAt: new Date().toISOString(),
        combinesWith: { orderDiscounts: true, productDiscounts: false, shippingDiscounts: true },
        metafields: [{ namespace: NAMESPACE, key: KEY, type: "json", value }],
      },
    });
    const errors = data.discountAutomaticAppCreate.userErrors;
    if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
    discountId = data.discountAutomaticAppCreate.automaticAppDiscount.discountId;
    return { rules: rules.length, discountId, created: true };
  }

  const data = await graphql(admin, METAFIELDS_MUTATION, {
    metafields: [{ ownerId: discountId, namespace: NAMESPACE, key: KEY, type: "json", value }],
  });
  const errors = data.metafieldsSet.userErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  return { rules: rules.length, discountId, created: false };
}

// For routes: never fails the merchant's action because of the discount sync.
export async function syncDiscountsSafely(shop, admin) {
  try {
    const result = await syncDiscounts(shop, admin);
    console.log(`Discount sync ${shop}: ${result.rules} rules${result.created ? " (discount created)" : ""}`);
    return { ok: true, ...result };
  } catch (error) {
    console.error(`Discount sync ${shop} failed:`, error.message);
    return { ok: false, error: error.message };
  }
}
