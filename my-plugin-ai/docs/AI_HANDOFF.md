# AI Handoff: SmartCart RCM

Last updated: 2026-11-17

Read this first in a new AI conversation, then `docs/ROADMAP.md` and `docs/PROGRESS_REPORT.md`.
System diagrams: `docs/flows/README.md` (English) and `docs/flows/README.vi.md` (Vietnamese).

## 1. What the project is

A Shopify embedded app plus a theme app extension that recommends products from order history. It is a graduation thesis project.

- **App:** SmartCart RCM, handle `smartcart-rcm`.
- **Demo store:** `my-favsion.myshopify.com`, a fashion store with Horizon theme.
- **Scope:** one shop at a time. No cross-shop data.

**Main flow:**

```text
CSV orders + Shopify orders -> OrderHistory
  -> training (Python FP-Growth / Item-kNN / DEC / Hybrid, JS Apriori fallback)
  -> RecommendationRule (max 50,000)
  -> App Proxy /apps/ai/recommend
  -> storefront widget (home, product, cart)
```

**User preferences:**

- The user writes Vietnamese; reply in Vietnamese.
- Docs and code comments are in English. Vietnamese copies exist where asked.
- Admin UI is planned to be bilingual VI/EN.
- Write docs short and simple.

## 2. Status

| Phase | Content | Status |
|---|---|---|
| 1 | Realistic demo shop: 452 products, 1,854 SKUs, real images, 12 collections, menu | Done |
| 2 | Core widget: App Proxy, per-item quota, keep 1–2 earlier suggestions, cache, fallbacks, Add to cart / Add all, size switch | Done |
| 3 | CSV import with column-role preview and a 1-1 product matching page | Done |
| 4 | ML strategies and offline evaluation (`docs/eval/`) | Done |
| — | Rules page, demo orders/customers, widget redesign | Done |
| 7 | Flow diagrams EN + VI (`docs/flows/`) | Done |
| 5 | Event tracking, Insights dashboard, A/B test (live + replay simulation), `docs/eval/AB_TEST.md` | Done |
| 6a | VI/EN admin (`app/i18n.js`), widget `locales/vi.json`, GDPR webhooks, test API off in production | Done |
| 6b | Discount Function (`extensions/smartcart-discount`, `app/discount.server.js`) | Done, not yet tried on the store |
| 6c | Vietnamese product titles on the storefront, Postgres + deploy | Later (`docs/LATER.md`) |

Offline evaluation result: FP-Growth HitRate@10 0.782 vs 0.745 for the Apriori baseline (1,000 carts × 3 seeds).
Replay A/B: AI vs best sellers, add-to-cart rate about 28% vs 13% (p < 0.0001). An A/A check gave 1 significant run of 20.

## 3. Key files (in `my-plugin-ai/`)

### Server logic (`app/`)

| File | Role |
|---|---|
| `recommendations.server.js` | `recommendForCart()`: combined rules → per-item rules (quota 5/3/2/1) → fallbacks (same category, recent orders, best seller, new arrival) → rankBy bonus. Returns `{products, cartKeys}`. |
| `catalog.server.js` | Shop catalog (cached 10 min). Product key = common prefix of variant SKUs, so sizes count as one product. |
| `training.server.js` | `runTraining({shop, adminForSync})`: syncs Shopify orders, picks the strategy, caps rules at 50,000, keeps merchant rules/edits, saves `ShopSettings.lastTrainSummary`. |
| `training-data.server.js` | Date window, loads orders, skips CSV orders already on Shopify (`csvOrderId`), maps CSV codes to shop products. |
| `python-trainer.server.js` | Spawns `ml/train.py`. Interpreter: `ML_PYTHON` env or `ml/.venv`. |
| `ai-logic.js` | JS Apriori, used as the fallback. |
| `scheduler.server.js` | Hourly check for weekly / monthly retrain. `DISABLE_SCHEDULER=1` turns it off. |
| `csv-format.js`, `csv-import.server.js` | Column roles, delimiter/date detection, streaming import. |
| `format.js` | Fixed-locale number/date formatting (avoids hydration mismatch). |
| `discount.server.js` | `syncDiscounts()`: active rules with discountPercent → product-id list in the metafield `$app:smartcart/discount-rules` of the automatic discount "SmartCart bundle discount" (created on first use). Called after every rule change and after training. Config capped at ~9.5 KB. |
| `i18n.js`, `language.server.js` | Admin translations. English text is the key: each page has `const VI = {...}` and `const t = useT(VI)`. Language = ShopSettings.language (auto/en/vi); auto follows Shopify's `?locale`. |
| `events.server.js` | Widget events (validated, group recomputed on the server), purchase attribution from orders/paid, A/B settings cache, interaction scores for the "interaction" priority. |
| `ab-stats.js` | z-test, 95% interval, sample size, visitor hash split, seeded random. |
| `insights.server.js` | Aggregates events per group / reason / product for the dashboard. |
| `replay.server.js` | Replay A/B simulation on held-out orders (`aaTest` for an A/A check). |

### Routes (`app/routes/`)

- `app.jsx`: layout with AppProvider (App Bridge) and Polaris. Nav: Recommendations, Rules, Data.
- `app._index.jsx`: home with Train button and status.
- `app.rules.jsx`: rules as product cards, with filters, Execute/Reset and sort.
- `app.data.jsx`: CSV import and training settings (algorithm, priority, schedule, window).
- `app.data_.match.jsx`: CSV → shop product matching (low-traffic page).
- `app.insights.jsx`: Insights dashboard, A/B settings, replay button.
- `apps.ai.event.jsx`: App Proxy POST endpoint for widget events.
- `app.language.jsx`: saves the admin language.
- `webhooks.compliance.jsx`: GDPR webhooks (data request, customer redact, shop redact).
- `apps.ai.recommend.jsx`: App Proxy endpoint used by the widget.
- `api.train.jsx`: authenticated training endpoint.
- `webhooks.orders.paid.jsx`: stores new orders with `customerId`, `lines`, `csvOrderId`.
- Legacy: `api.recommend.jsx` is a CORS test endpoint, disabled when NODE_ENV=production.

### Widget

- **Source:** `widget-src/recommendations.js`. Do not edit the built file.
- **Build:** `npm run build:widget` writes `extensions/ai-widget/assets/recommendations.js`. App block JS must stay under 10 KB.
- **Other files:**
  - `extensions/ai-widget/blocks/ai-recommendations.liquid` (settings: heading, max_products, card_size, show_size_switch, show_add_to_cart)
  - `recommendations.css`
  - `locales/en.default.json`
- **Block type:** `shopify://apps/smartcart-rcm/blocks/ai-recommendations/01a1988b-57d8-71f5-a4d5-4f5cfacab99e`.
- **App Proxy** (`shopify.app.toml`): prefix `apps`, subpath `ai`, url `https://shopify.dev/apps/ai`. The CLI rewrites the host during dev.

### Discount Function (`extensions/smartcart-discount`)

- Target `cart.lines.discounts.generate.run`, vanilla JS compiled to WASM by the CLI.
- Rule applies when every `when` product and the suggested product are in the cart; best percent per product, max 90%.
- Tests: `node tests/make-fixtures.mjs` then `npx vitest run` inside the extension folder (7 cases).
- Needs the `read_discounts,write_discounts` scopes.

### Database (`prisma/schema.prisma`, SQLite `prisma/dev.sqlite`)

**Models:**

- `Session`
- `RecommendationEvent` (type, visitorId, variant, productKey, reason, items, value, recValue, simulated)
- `RecommendationRule` (shop, cartProducts, cartSize, suggestProduct, confidence, support, source model/merchant, status, priority, discountPercent)
- `OrderHistory` (customerId, lines, csvOrderId)
- `CsvImport`
- `CsvProduct`
- `ShopSettings` (train window, strategy, rankBy, retrainSchedule, lastTrainedAt, lastTrainSummary, abEnabled, abControlShare, abStartedAt, lastReplaySummary)

**Latest migration:** `20261117163436_add_admin_language`.

### ML (`ml/`)

- **Files:**
  - `data.py`, `recommenders.py` (Popularity, Apriori, FP-Growth, ItemKNN, Hybrid RRF k=60)
  - `dec.py` (PyTorch)
  - `evaluate.py`, `train.py` (`--max-rules 50000`)
- **Dependencies:** `requirements.txt` (numpy, pandas, scikit-learn, mlxtend, torch CPU, matplotlib).

### Scripts

- `scripts/catalog/` builds and seeds the demo catalog (Fashion Product Images + Tstars-VTON).
- `scripts/demo/seed-demo-orders.mjs` imports the UCI CSV and matches products. `push-demo-orders.mjs` creates Shopify customers/orders.
  - Run both with `node --import ./scripts/lib/register-app-imports.mjs <script> --shop my-favsion.myshopify.com`.
- `scripts/demo/run-replay.mjs` runs the replay A/B from the command line.
- `scripts/docs/render-diagrams.mjs` (`npm run docs:diagrams`) renders Mermaid sources to PNG. It uses local Chrome.

## 4. Setup on a new machine

```powershell
cd my-plugin-ai
npm install
npx prisma generate
npx prisma migrate deploy
python -m venv ml\.venv
ml\.venv\Scripts\pip install -r ml\requirements.txt
npm run dev
```

**Data that is not in git:**

- `prisma/dev.sqlite`
- `data/` (CSV, catalog JSON, images)
- `.env`

Copy them through a private channel.

**Run `shopify app dev` on only one machine at a time.**

## 5. Rules and cautions

- **Never commit** `prisma/dev.sqlite` (contains the shop access token) or `.env` (contains `HF_TOKEN`). Never paste tokens in chat.
- **Images and sources:**
  - Tstars images are CC BY-NC-ND: no modification, keep attribution.
  - Do not scrape Pinterest or Shopee.
- **Demo data:**
  - The data is simulated: real UCI basket structure mapped onto the shop's own products. Say this in reports.
  - Demo customers use synthetic names and `@example.com` emails. Orders are created without sending emails.
- **Dev store:** order creation is rate-limited to about 5 orders per minute.
- **Windows:** `npm run build` may fail with Prisma EPERM while the dev server runs; stop the dev server first.
- **Commands the user runs themselves:** `shopify app deploy` (needed after widget changes) and killing processes.

## 6. Next work

See `docs/LATER.md`: manual checks still to do, Discount Function, Vietnamese product titles (`titleVi` in the catalog; needs `write_translations` / `write_locales` scopes), Postgres + deploy.

New UI text: add it to the page's `VI` map and wrap it in `t()`.

## 7. Prompt for a new conversation

```text
Read docs/AI_HANDOFF.md first, then docs/ROADMAP.md and docs/PROGRESS_REPORT.md.
Continue SmartCart RCM from the current repository state. Do not reset existing changes.
Reply in Vietnamese. Keep docs short and simple.
```
