// Copies one shop's data from the local SQLite database to the production Postgres database
// (Render), so the deployed app starts with the same orders, rules, CSV matches, settings,
// replay events and login session as local development.
//
// Usage (from my-plugin-ai/, with the Postgres "External Database URL" from Render):
//   $env:PG_URL = "postgresql://..."      (PowerShell; never commit or paste this URL)
//   npm run db:copy-to-postgres -- --shop my-favsion.myshopify.com
//
// The Postgres tables must exist: deploy the app once first (it runs the migrations on start).
// Rows of that shop already in Postgres are deleted first, so the script can be run again.

import process from "node:process";
import pg from "pg";
import prisma from "../../app/db.server.js";

// Tables in a safe order, with the Prisma model that reads them from SQLite.
const TABLES = [
  ["Session", "session"],
  ["ShopSettings", "shopSettings"],
  ["CsvImport", "csvImport"],
  ["CsvProduct", "csvProduct"],
  ["OrderHistory", "orderHistory"],
  ["RecommendationRule", "recommendationRule"],
  ["RecommendationEvent", "recommendationEvent"],
];
const BATCH = 500;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--shop") args.shop = argv[++i];
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  if (!args.shop) throw new Error("--shop is required");
  if (!process.env.PG_URL) throw new Error("Set PG_URL to the Render Postgres External Database URL");
  return args;
}

async function copyTable(client, table, model, shop) {
  const rows = await prisma[model].findMany({ where: { shop } });
  await client.query(`DELETE FROM "${table}" WHERE "shop" = $1`, [shop]);
  if (rows.length === 0) return 0;
  const columns = Object.keys(rows[0]);
  const columnList = columns.map((column) => `"${column}"`).join(", ");
  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH);
    const values = [];
    const tuples = batch.map((row, rowIndex) => {
      const marks = columns.map((column, columnIndex) => {
        const value = row[column];
        values.push(typeof value === "bigint" ? value.toString() : value);
        return `$${rowIndex * columns.length + columnIndex + 1}`;
      });
      return `(${marks.join(", ")})`;
    });
    await client.query(`INSERT INTO "${table}" (${columnList}) VALUES ${tuples.join(", ")}`, values);
  }
  // Autoincrement ids were copied as they are: move the sequence past the highest one.
  if (columns.includes("id") && typeof rows[0].id === "number") {
    await client.query(
      `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), (SELECT COALESCE(MAX("id"), 1) FROM "${table}"))`,
    );
  }
  return rows.length;
}

async function main() {
  const { shop } = parseArgs(process.argv.slice(2));
  const client = new pg.Client({ connectionString: process.env.PG_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const [table, model] of TABLES) {
      const count = await copyTable(client, table, model, shop);
      console.log(`${table}: ${count} rows`);
    }
    await client.query("COMMIT");
    console.log("Done.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
