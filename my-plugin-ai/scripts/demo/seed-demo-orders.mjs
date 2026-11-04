/* eslint-env node */
// Demo data for a shop: import a historical order CSV and match its most ordered products
// to the shop's products, so training produces realistic co-purchase rules.
//
// The CSV (UCI Online Retail, a UK gift shop) does not sell the shop's products, so this is a
// SIMULATION: the purchase structure (what is bought together, how often, when) is real;
// the products it is attached to are the shop's own. Matching is one to one and keeps
// co-purchased CSV products on the same gender and on complementary departments
// (tops / bottoms / shoes / bags / accessories), so the rules read like outfits.
//
// Usage (from my-plugin-ai/):
//   node --import ./scripts/lib/register-app-imports.mjs scripts/demo/seed-demo-orders.mjs \
//     --shop my-favsion.myshopify.com [--csv data/data.csv] [--catalog data/catalog/fashion-catalog.json ...]

import fs from "fs";
import prisma from "../../app/db.server.js";
import { importCsvOrders } from "../../app/csv-import.server.js";

function parseArgs(argv) {
  const args = { csv: "data/data.csv", catalogs: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shop") args.shop = argv[++i];
    else if (argv[i] === "--csv") args.csv = argv[++i];
    else if (argv[i] === "--catalog") args.catalogs.push(argv[++i]);
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  if (!args.shop) throw new Error("--shop is required");
  if (args.catalogs.length === 0) args.catalogs = ["data/catalog/fashion-catalog.json", "data/catalog/tstars/catalog.json"];
  return args;
}

// Product keys of the catalogs (base SKU), with gender and department.
function loadShopProducts(paths) {
  return paths.filter((file) => fs.existsSync(file)).flatMap((file) =>
    JSON.parse(fs.readFileSync(file, "utf8")).products.map((product) => ({
      key: product.baseSku,
      title: product.title,
      gender: product.attributes.gender,
      department: product.attributes.department,
    })));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const shop = args.shop;
  const products = loadShopProducts(args.catalogs);
  console.log(`Shop products: ${products.length}`);

  // 1. Import the CSV exactly as the Data page does.
  const columnMap = { orderId: "InvoiceNo", productCode: "StockCode", productName: "Description", quantity: "Quantity", date: "InvoiceDate", price: "UnitPrice", customerId: "CustomerID" };
  const result = await importCsvOrders({
    shop,
    file: new File([fs.readFileSync(args.csv)], "data.csv"),
    fileName: "data.csv (demo)",
    delimiter: ",",
    columnMap,
    dateFormat: "mdy",
    mode: "replace",
  });
  console.log(`Imported ${result.orderCount} orders from ${result.rowCount} rows`);

  // 2. Co-occurrence between the most ordered CSV products.
  const csvProducts = await prisma.csvProduct.findMany({ where: { shop }, orderBy: { orderCount: "desc" } });
  const fees = new Set(["POST", "DOT", "M", "C2", "D", "S", "B", "CRUK", "PADS", "BANK CHARGES", "AMAZONFEE"]);
  const top = csvProducts.filter((row) => !fees.has(row.code)).slice(0, products.length);
  const topCodes = new Set(top.map((row) => row.code));
  const neighbours = new Map(top.map((row) => [row.code, new Map()]));
  const orders = await prisma.orderHistory.findMany({ where: { shop, source: "csv_import" }, select: { productIds: true } });
  for (const order of orders) {
    const codes = JSON.parse(order.productIds).filter((code) => topCodes.has(code));
    for (const a of codes) for (const b of codes) {
      if (a !== b) neighbours.get(a).set(b, (neighbours.get(a).get(b) ?? 0) + 1);
    }
  }

  // 3. Greedy matching: each CSV product takes a free shop product whose gender agrees with
  //    its strongest already-matched neighbours and whose department they cover least.
  const free = new Map();
  for (const product of products) {
    const key = `${product.gender}|${product.department}`;
    if (!free.has(key)) free.set(key, []);
    free.get(key).push(product);
  }
  const genders = [...new Set(products.map((product) => product.gender))];
  const departments = [...new Set(products.map((product) => product.department))];
  const assigned = new Map();
  const freeCount = (gender, department) => free.get(`${gender}|${department}`)?.length ?? 0;

  for (const row of top) {
    const strongest = [...neighbours.get(row.code).entries()]
      .filter(([code]) => assigned.has(code))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code]) => assigned.get(code));

    const genderVotes = new Map();
    strongest.forEach((product) => genderVotes.set(product.gender, (genderVotes.get(product.gender) ?? 0) + 1));
    const genderOrder = [...genders].sort((a, b) =>
      (genderVotes.get(b) ?? 0) - (genderVotes.get(a) ?? 0) ||
      departments.reduce((sum, d) => sum + freeCount(b, d), 0) - departments.reduce((sum, d) => sum + freeCount(a, d), 0));

    let chosen = null;
    for (const gender of genderOrder) {
      const covered = new Map();
      strongest.forEach((product) => covered.set(product.department, (covered.get(product.department) ?? 0) + 1));
      const options = departments
        .filter((department) => freeCount(gender, department) > 0)
        .sort((a, b) => (covered.get(a) ?? 0) - (covered.get(b) ?? 0) || freeCount(gender, b) - freeCount(gender, a));
      if (options.length) {
        chosen = free.get(`${gender}|${options[0]}`).shift();
        break;
      }
    }
    if (!chosen) break;
    assigned.set(row.code, chosen);
  }

  await prisma.$transaction([
    prisma.csvProduct.updateMany({ where: { shop }, data: { shopProductKey: null } }),
    ...[...assigned.entries()].map(([code, product]) =>
      prisma.csvProduct.update({ where: { shop_code: { shop, code } }, data: { shopProductKey: product.key } })),
  ]);
  console.log(`Matched ${assigned.size} CSV products to shop products (1-1).`);

  const sample = top.slice(0, 5).map((row) => `  ${row.name} (${row.code}) -> ${assigned.get(row.code)?.title}`);
  console.log(sample.join("\n"));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
