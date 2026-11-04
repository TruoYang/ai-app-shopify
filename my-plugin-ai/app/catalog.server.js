// Per-shop product catalog used by the recommender.
//
// Recommendations work on products, not on sizes/colours: every variant SKU maps to a
// product key. The key is the common prefix of the product's variant SKUs
// (AUR-TOP-8558-S / -M / -L -> AUR-TOP-8558), the SKU itself for single-variant
// products, or the product ID when the variant SKUs share nothing.

const CATALOG_TTL_MS = 10 * 60_000;
const catalogCache = new Map();

const PRODUCTS_QUERY = `
  query RecommenderCatalog($after: String) {
    products(first: 40, after: $after, query: "status:active") {
      nodes {
        id
        title
        handle
        productType
        tags
        createdAt
        featuredImage { url }
        priceRangeV2 { minVariantPrice { amount currencyCode } }
        compareAtPriceRange { maxVariantCompareAtPrice { amount } }
        variants(first: 20) {
          nodes { id sku availableForSale }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

function commonPrefix(values) {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

export function productKeyFor(product) {
  const skus = product.variants.nodes.map((variant) => variant.sku?.trim()).filter(Boolean);
  if (skus.length === 0) return product.id;
  if (skus.length === 1) return skus[0];
  // Cut back to a separator so sizes 30/32/34 do not leave a stray "3" in the key.
  let prefix = commonPrefix(skus);
  const endsOnBoundary = skus.every((sku) => sku.length === prefix.length || /[-_\s/.]/.test(sku[prefix.length]));
  if (!endsOnBoundary) prefix = prefix.slice(0, Math.max(...["-", "_", " ", "/", "."].map((sep) => prefix.lastIndexOf(sep))) + 1);
  prefix = prefix.replace(/[-_\s/.]+$/, "");
  return prefix.length >= 3 ? prefix : product.id;
}

function toCatalogProduct(product) {
  const variants = product.variants.nodes;
  const available = variants.find((variant) => variant.availableForSale) ?? variants[0];
  const compareAt = Number(product.compareAtPriceRange?.maxVariantCompareAtPrice?.amount ?? 0);
  const price = Number(product.priceRangeV2.minVariantPrice.amount);

  return {
    key: productKeyFor(product),
    id: product.id,
    title: product.title,
    handle: product.handle,
    productType: product.productType,
    tags: product.tags,
    createdAt: product.createdAt,
    image: product.featuredImage?.url ?? null,
    price,
    compareAtPrice: compareAt > price ? compareAt : null,
    currency: product.priceRangeV2.minVariantPrice.currencyCode,
    url: `/products/${product.handle}`,
    variantId: available?.id ?? null,
    available: variants.some((variant) => variant.availableForSale),
  };
}

/**
 * Returns { products: Map<key, product>, keyBySku: Map<sku, key> } for a shop.
 * `admin` is an Admin API client for that shop.
 */
export async function getShopCatalog(shop, admin) {
  const cached = catalogCache.get(shop);
  if (cached && cached.expiresAt > Date.now()) return cached.catalog;

  const products = new Map();
  const keyBySku = new Map();
  let after = null;

  do {
    const response = await admin.graphql(PRODUCTS_QUERY, { variables: { after } });
    const json = await response.json();
    const page = json.data?.products;
    if (!page) throw new Error(json.errors?.[0]?.message ?? "Could not load products");

    for (const node of page.nodes) {
      const product = toCatalogProduct(node);
      products.set(product.key, product);
      for (const variant of node.variants.nodes) {
        if (variant.sku?.trim()) keyBySku.set(variant.sku.trim(), product.key);
      }
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  const catalog = { products, keyBySku };
  catalogCache.set(shop, { catalog, expiresAt: Date.now() + CATALOG_TTL_MS });
  return catalog;
}

// Maps a SKU (variant or already a product key) to its product key.
// SKUs that are not in the shop (for example raw CSV codes) are returned unchanged.
export const toProductKey = (catalog, sku) => catalog.keyBySku.get(sku) ?? sku;
