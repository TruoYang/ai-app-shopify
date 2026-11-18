// Runs the A/B replay simulation (app/replay.server.js) from the command line, then prints the
// same z-test the Insights page shows. The Insights page has a button that does the same.
//
// Usage (from my-plugin-ai/):
//   node --import ./scripts/lib/register-app-imports.mjs scripts/demo/run-replay.mjs \
//     --shop my-favsion.myshopify.com [--sessions 2000] [--control 50] [--seed 42]

import process from "node:process";
import prisma from "../../app/db.server.js";
import { runReplay } from "../../app/replay.server.js";
import { getInsights } from "../../app/insights.server.js";

const API_VERSION = "2025-10";

function parseArgs(argv) {
  const args = { sessions: 2000, control: 50, seed: 42 };
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].replace(/^--/, "");
    if (!(name === "shop" || name in args)) throw new Error(`Unknown option ${argv[i]}`);
    args[name] = name === "shop" ? argv[++i] : Number(argv[++i]);
  }
  if (!args.shop) throw new Error("--shop is required");
  return args;
}

// Minimal Admin API client with the same shape as the app's `admin` object.
function adminFor(shop, accessToken) {
  return {
    graphql: (query, { variables } = {}) =>
      fetch(`https://${shop}/admin/api/${API_VERSION}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
        body: JSON.stringify({ query, variables }),
      }),
  };
}

const pct = (value) => (value == null ? "-" : `${(value * 100).toFixed(2)}%`);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const session = await prisma.session.findFirst({ where: { shop: args.shop, isOnline: false } });
  if (!session) throw new Error(`No offline session for ${args.shop}`);

  const summary = await runReplay({
    shop: args.shop,
    admin: adminFor(args.shop, session.accessToken),
    sessions: args.sessions,
    controlShare: args.control,
    seed: args.seed,
  });
  console.log("Replay:", summary);

  const insights = await getInsights({ shop: args.shop, simulated: true, days: null });
  for (const group of insights.groups) {
    console.log(`${group.variant.padEnd(8)} visitors=${group.visitors} CTR=${pct(group.clickRate)} add=${pct(group.addRate)} rec revenue/visitor=${group.recRevenuePerVisitor.toFixed(2)}`);
  }
  for (const [name, test] of Object.entries(insights.tests)) {
    if (!test) continue;
    console.log(`${name}: lift=${pct(test.lift)} diff=${pct(test.diff)} CI95=[${pct(test.ci95[0])}, ${pct(test.ci95[1])}] z=${test.z.toFixed(2)} p=${test.pValue.toExponential(2)} ${test.significant ? "SIGNIFICANT" : "not significant"}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
