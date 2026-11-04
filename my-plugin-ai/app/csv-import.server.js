// Import historical orders from CSV files with arbitrary column names.
//
// The merchant assigns a role to each column on the Data page; guessRoles() pre-fills
// those choices from the header names (English, Vietnamese and Shopify order exports).

import { parse } from "csv-parse";
import { Readable } from "stream";
import prisma from "./db.server";
import { parseDate, parseNumber, REQUIRED_ROLES } from "./csv-format";

const BATCH_SIZE = 1000;

/**
 * Imports a CSV (Web File/Blob) for a shop.
 * columnMap: { role: headerName }, dateFormat: "iso" | "dmy" | "mdy", mode: "replace" | "append".
 */
export async function importCsvOrders({ shop, file, fileName, delimiter, columnMap, dateFormat, mode }) {
  for (const role of REQUIRED_ROLES) {
    if (!columnMap[role]) throw new Error(`Missing column for ${role}`);
  }

  const parser = Readable.fromWeb(file.stream()).pipe(parse({
    delimiter,
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    trim: true,
  }));

  const orders = new Map();
  const products = new Map();
  let rowCount = 0;
  let skippedRows = 0;

  for await (const record of parser) {
    rowCount++;
    const orderId = record[columnMap.orderId];
    const code = record[columnMap.productCode];
    const quantity = columnMap.quantity ? parseNumber(record[columnMap.quantity]) : 1;
    // Returns and cancellations show up as zero or negative quantities.
    if (!orderId || !code || quantity === null || quantity <= 0) {
      skippedRows++;
      continue;
    }

    let order = orders.get(orderId);
    if (!order) {
      order = {
        codes: new Set(),
        lines: new Map(),
        date: columnMap.date ? parseDate(record[columnMap.date], dateFormat) : null,
        customerId: null,
      };
      orders.set(orderId, order);
    }
    order.codes.add(code);
    if (!order.customerId && columnMap.customerId) {
      // Numeric IDs are often exported as "17850.0".
      const customer = String(record[columnMap.customerId] ?? "").trim().replace(/\.0+$/, "");
      if (customer) order.customerId = customer;
    }
    // One line per product: quantities of repeated lines are added up.
    const line = order.lines.get(code) ?? { code, quantity: 0, price: null };
    line.quantity += quantity;
    if (line.price === null && columnMap.price) line.price = parseNumber(record[columnMap.price]);
    order.lines.set(code, line);

    let product = products.get(code);
    if (!product) {
      product = { name: null, orders: new Set() };
      products.set(code, product);
    }
    product.orders.add(orderId);
    if (!product.name && columnMap.productName) product.name = record[columnMap.productName] || null;
  }

  if (mode === "replace") {
    await prisma.orderHistory.deleteMany({ where: { shop, source: "csv_import" } });
  }

  const rows = [...orders.entries()].map(([orderId, order]) => ({
    shop,
    orderId: `csv_${orderId}`,
    productIds: JSON.stringify([...order.codes].sort()),
    orderDate: order.date,
    customerId: order.customerId,
    lines: JSON.stringify([...order.lines.values()]),
    source: "csv_import",
  }));
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    if (mode === "append") {
      // SQLite has no skipDuplicates: drop orders that are already stored.
      const existing = await prisma.orderHistory.findMany({
        where: { shop, orderId: { in: batch.map((row) => row.orderId) } },
        select: { orderId: true },
      });
      const seen = new Set(existing.map((row) => row.orderId));
      await prisma.orderHistory.createMany({ data: batch.filter((row) => !seen.has(row.orderId)) });
    } else {
      await prisma.orderHistory.createMany({ data: batch });
    }
  }

  // Recount CSV products from everything stored, keeping existing shop matches.
  await saveCsvProducts(shop, products, mode);

  return prisma.csvImport.create({
    data: {
      shop,
      fileName,
      columnMap: JSON.stringify({ ...columnMap, delimiter, dateFormat }),
      mode,
      rowCount,
      orderCount: orders.size,
      skippedRows,
    },
  });
}

async function saveCsvProducts(shop, products, mode) {
  const existing = await prisma.csvProduct.findMany({ where: { shop } });
  const existingByCode = new Map(existing.map((row) => [row.code, row]));

  const operations = [];
  for (const [code, product] of products) {
    const previous = existingByCode.get(code);
    const orderCount = product.orders.size + (mode === "append" && previous ? previous.orderCount : 0);
    operations.push(prisma.csvProduct.upsert({
      where: { shop_code: { shop, code } },
      update: { orderCount, name: product.name ?? previous?.name ?? null },
      create: { shop, code, name: product.name, orderCount },
    }));
  }
  if (mode === "replace") {
    // Products that no longer appear in any CSV order are dropped, matches included.
    const keep = new Set(products.keys());
    operations.push(prisma.csvProduct.deleteMany({
      where: { shop, code: { notIn: [...keep] } },
    }));
  }
  for (let i = 0; i < operations.length; i += 500) {
    await prisma.$transaction(operations.slice(i, i + 500));
  }
}
