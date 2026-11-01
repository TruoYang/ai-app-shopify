/* eslint-env node */
// Seed a Shopify store with the demo fashion catalog (data/catalog/fashion-catalog.json).
// Product photos are read from data/catalog/images (see download-catalog-images.mjs).
//
// Uses the offline session that the app stores in Prisma after it has been installed
// on the target store, so no extra token is needed.
//
// Usage (from my-plugin-ai/):
//   node scripts/catalog/seed-shopify-catalog.mjs --shop my-store.myshopify.com
//   node scripts/catalog/seed-shopify-catalog.mjs --dry-run
// Options:
//   --shop <domain>       Target store (defaults to the only installed store)
//   --catalog <path>      Catalog JSON (default data/catalog/fashion-catalog.json)
//   --limit <n>           Only seed the first n products
//   --update              Re-send products that already exist (matched by handle); keeps their images
//   --skip-collections    Do not create smart collections
//   --skip-menu           Do not rebuild the storefront main menu
//   (use --limit 0 to only create collections and the menu)
//   --dry-run             Print what would be created without calling Shopify

import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const API_VERSION = "2025-10";
const REQUIRED_SCOPES = ["write_products", "write_publications"];

function parseArgs(argv) {
  const args = { catalog: "data/catalog/fashion-catalog.json" };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--shop") args.shop = argv[++i];
    else if (key === "--catalog") args.catalog = argv[++i];
    else if (key === "--limit") args.limit = Number.parseInt(argv[++i], 10);
    else if (key === "--update") args.update = true;
    else if (key === "--skip-collections") args.skipCollections = true;
    else if (key === "--skip-menu") args.skipMenu = true;
    else if (key === "--dry-run") args.dryRun = true;
    else throw new Error(`Unknown option: ${key}`);
  }
  return args;
}

// Storefront main menu: collection handles, optionally with a nested list.
const MAIN_MENU = [
  { title: "Women", collection: "women" },
  { title: "Men", collection: "men" },
  {
    title: "Clothing",
    collection: "tops",
    items: [
      { title: "Tops", collection: "tops" },
      { title: "Outerwear", collection: "outerwear" },
      { title: "Bottoms", collection: "bottoms" },
      { title: "Dresses", collection: "dresses" },
    ],
  },
  { title: "Shoes", collection: "shoes" },
  { title: "Bags", collection: "bags" },
  { title: "Hats & Caps", collection: "hats-and-caps" },
  { title: "Accessories", collection: "accessories" },
  { title: "Sale", collection: "sale" },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadSession(shop) {
  const prisma = new PrismaClient();
  try {
    const sessions = await prisma.session.findMany({
      where: { isOnline: false, ...(shop ? { shop } : {}) },
    });
    if (sessions.length === 0) {
      throw new Error(
        shop
          ? `No offline session for ${shop}. Run "shopify app dev" on that store and open the app once.`
          : "No installed store found. Run \"shopify app dev\" and open the app once.",
      );
    }
    if (sessions.length > 1) {
      throw new Error(
        `Several stores are installed (${sessions.map((s) => s.shop).join(", ")}). Pass --shop.`,
      );
    }
    return sessions[0];
  } finally {
    await prisma.$disconnect();
  }
}

function createClient(session) {
  const endpoint = `https://${session.shop}/admin/api/${API_VERSION}/graphql.json`;

  return async function graphql(query, variables = {}) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": session.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      });

      if (response.status === 429 || response.status >= 500) {
        await sleep(1000 * (attempt + 1));
        continue;
      }

      const json = await response.json();
      const throttled = json.errors?.some((error) => error.extensions?.code === "THROTTLED");
      if (throttled) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (json.errors?.length) {
        throw new Error(json.errors.map((error) => error.message).join("; "));
      }

      // Stay well under the cost bucket so long runs do not get throttled.
      const available = json.extensions?.cost?.throttleStatus?.currentlyAvailable;
      if (typeof available === "number" && available < 200) await sleep(1500);

      return json.data;
    }
    throw new Error("Shopify API kept throttling the request");
  };
}

// Upload a local image to Shopify's staging storage and return a URL productSet can use.
async function uploadImage(graphql, catalogDir, image) {
  const filePath = path.join(catalogDir, image.path);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}. Run scripts/catalog/download-catalog-images.mjs first.`);
  }
  const bytes = fs.readFileSync(filePath);
  const filename = path.basename(filePath);

  const data = await graphql(
    `mutation StageImage($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [{
        resource: "IMAGE",
        filename,
        mimeType: "image/jpeg",
        httpMethod: "POST",
        fileSize: String(bytes.length),
      }],
    },
  );
  const { stagedTargets, userErrors } = data.stagedUploadsCreate;
  if (userErrors.length) throw new Error(userErrors.map((error) => error.message).join("; "));

  const target = stagedTargets[0];
  const form = new FormData();
  target.parameters.forEach(({ name, value }) => form.append(name, value));
  form.append("file", new Blob([bytes], { type: "image/jpeg" }), filename);

  const response = await fetch(target.url, { method: "POST", body: form });
  if (!response.ok) throw new Error(`Image upload failed (${response.status}) for ${filename}`);
  return target.resourceUrl;
}

async function fetchExistingHandles(graphql, connection) {
  const handles = new Map();
  let after = null;
  do {
    const data = await graphql(
      `query Handles($after: String) {
        ${connection}(first: 250, after: $after) {
          nodes { id handle }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after },
    );
    const page = data[connection];
    page.nodes.forEach((node) => handles.set(node.handle, node.id));
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return handles;
}

async function findOnlineStorePublication(graphql) {
  const data = await graphql(`{ publications(first: 50) { nodes { id name } } }`);
  const publication = data.publications.nodes.find((node) => node.name === "Online Store");
  if (!publication) throw new Error("Online Store sales channel not found on this store");
  return publication.id;
}

async function publish(graphql, id, publicationId) {
  const data = await graphql(
    `mutation Publish($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) { userErrors { field message } }
    }`,
    { id, input: [{ publicationId }] },
  );
  const errors = data.publishablePublish.userErrors;
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
}

// Without imageUrl the files field is left out, so existing product media is kept.
function buildProductInput(product, imageUrl) {
  return {
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    status: "ACTIVE",
    ...(product.seo ? { seo: product.seo } : {}),
    ...(product.metafields ? { metafields: product.metafields } : {}),
    productOptions: [
      { name: product.option.name, values: product.option.values.map((name) => ({ name })) },
    ],
    ...(imageUrl
      ? { files: [{ originalSource: imageUrl, contentType: "IMAGE", alt: product.image.alt }] }
      : {}),
    variants: product.variants.map((variant) => ({
      optionValues: [{ optionName: product.option.name, name: variant.option }],
      sku: variant.sku,
      price: variant.price.toFixed(2),
      compareAtPrice: variant.compareAtPrice ? variant.compareAtPrice.toFixed(2) : null,
      inventoryPolicy: "DENY",
      inventoryItem: {
        tracked: false,
        requiresShipping: true,
        ...(product.weightGrams
          ? { measurement: { weight: { value: product.weightGrams, unit: "GRAMS" } } }
          : {}),
      },
    })),
  };
}

async function seedProduct(graphql, catalogDir, product, publicationId, keepMedia) {
  const imageUrl = keepMedia ? null : await uploadImage(graphql, catalogDir, product.image);
  const data = await graphql(
    `mutation SeedProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers) {
      productSet(input: $input, identifier: $identifier, synchronous: true) {
        product { id variants(first: 20) { nodes { id sku } } }
        userErrors { field message }
      }
    }`,
    { input: buildProductInput(product, imageUrl), identifier: { handle: product.handle } },
  );

  const { product: created, userErrors } = data.productSet;
  if (userErrors.length) throw new Error(userErrors.map((error) => error.message).join("; "));

  await publish(graphql, created.id, publicationId);
  return created;
}

async function seedCollections(graphql, collections, publicationId) {
  const existing = await fetchExistingHandles(graphql, "collections");
  for (const collection of collections) {
    if (existing.has(collection.handle)) {
      console.log(`  = collection ${collection.title} already exists`);
      continue;
    }
    const data = await graphql(
      `mutation SeedCollection($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection { id }
          userErrors { field message }
        }
      }`,
      {
        input: {
          title: collection.title,
          handle: collection.handle,
          descriptionHtml: collection.descriptionHtml,
          ruleSet: { appliedDisjunctively: collection.disjunctive ?? false, rules: collection.rules },
        },
      },
    );
    const { collection: created, userErrors } = data.collectionCreate;
    if (userErrors.length) {
      console.warn(`  ! collection ${collection.title}: ${userErrors.map((e) => e.message).join("; ")}`);
      continue;
    }
    await publish(graphql, created.id, publicationId);
    console.log(`  + collection ${collection.title}`);
  }
}

// Replaces the items of the theme's "main-menu" with MAIN_MENU.
// Needs the write_online_store_navigation scope.
async function seedMenu(graphql) {
  const data = await graphql(`{
    menus(first: 20) { nodes { id handle title } }
    collections(first: 250) { nodes { id handle } }
  }`);
  const menu = data.menus.nodes.find((node) => node.handle === "main-menu");
  if (!menu) throw new Error("Main menu (handle main-menu) not found");

  const collectionIds = new Map(data.collections.nodes.map((node) => [node.handle, node.id]));
  const toItem = (entry) => {
    const resourceId = collectionIds.get(entry.collection);
    if (!resourceId) throw new Error(`Collection ${entry.collection} not found; seed collections first`);
    return {
      title: entry.title,
      type: "COLLECTION",
      resourceId,
      items: (entry.items ?? []).map(toItem),
    };
  };

  const result = await graphql(
    `mutation SeedMenu($id: ID!, $title: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, items: $items) {
        menu { id }
        userErrors { field message }
      }
    }`,
    { id: menu.id, title: menu.title, items: MAIN_MENU.map(toItem) },
  );
  const { userErrors } = result.menuUpdate;
  if (userErrors.length) throw new Error(userErrors.map((error) => error.message).join("; "));
  console.log(`  + main menu: ${MAIN_MENU.map((entry) => entry.title).join(", ")}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = JSON.parse(fs.readFileSync(args.catalog, "utf8"));
  const products = Number.isInteger(args.limit) ? catalog.products.slice(0, args.limit) : catalog.products;

  if (args.dryRun) {
    const variants = products.reduce((sum, product) => sum + product.variants.length, 0);
    console.log(`Dry run: ${products.length} products, ${variants} variants, ${catalog.collections.length} collections`);
    products.slice(0, 5).forEach((product) =>
      console.log(` - ${product.title} [${product.productType}] ${product.variants.map((v) => v.sku).join(", ")}`),
    );
    return;
  }

  const session = await loadSession(args.shop);
  const grantedScopes = (session.scope ?? "").split(",").map((scope) => scope.trim());
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !grantedScopes.includes(scope));
  if (missingScopes.length) {
    throw new Error(
      `The app on ${session.shop} is missing scopes: ${missingScopes.join(", ")}. ` +
        "Restart \"shopify app dev\" and open the app in the admin to approve the new scopes.",
    );
  }

  const graphql = createClient(session);
  const publicationId = await findOnlineStorePublication(graphql);
  const existingProducts = await fetchExistingHandles(graphql, "products");
  console.log(`Seeding ${products.length} products into ${session.shop}`);

  const result = { shop: session.shop, seededAt: new Date().toISOString(), products: [] };
  let created = 0;
  let skipped = 0;
  const failed = [];

  for (const [index, product] of products.entries()) {
    const label = `[${index + 1}/${products.length}] ${product.title}`;
    if (existingProducts.has(product.handle) && !args.update) {
      skipped++;
      console.log(`  = ${label} (exists)`);
      continue;
    }
    try {
      const shopifyProduct = await seedProduct(
        graphql, path.dirname(args.catalog), product, publicationId, existingProducts.has(product.handle),
      );
      result.products.push({
        handle: product.handle,
        productId: shopifyProduct.id,
        variants: shopifyProduct.variants.nodes,
      });
      created++;
      console.log(`  + ${label}`);
    } catch (error) {
      failed.push({ handle: product.handle, error: error.message });
      console.warn(`  ! ${label}: ${error.message}`);
    }
  }

  if (!args.skipCollections) {
    console.log("Creating collections");
    await seedCollections(graphql, catalog.collections, publicationId);
  }

  if (!args.skipMenu) {
    console.log("Updating main menu");
    try {
      await seedMenu(graphql);
    } catch (error) {
      console.warn(`  ! main menu: ${error.message}`);
    }
  }

  // Merge with earlier runs so partial runs (--limit) keep the IDs already recorded.
  const resultPath = path.join("data", "catalog", `seed-result-${session.shop}.json`);
  const previous = fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, "utf8")).products ?? [] : [];
  const merged = new Map(previous.map((entry) => [entry.handle, entry]));
  result.products.forEach((entry) => merged.set(entry.handle, entry));
  fs.writeFileSync(resultPath, JSON.stringify({ ...result, products: [...merged.values()], failed }, null, 2));
  console.log(`Done: ${created} created/updated, ${skipped} skipped, ${failed.length} failed. Log: ${resultPath}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
