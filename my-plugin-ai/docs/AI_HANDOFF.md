# AI Handoff - Shopify Product Recommendation App

Last updated: 2026-10-22

## 1. Project Overview

This is a Shopify embedded app and Theme App Extension for product recommendations.

Main business flow:

```text
Historical orders / CSV
    -> OrderHistory database records
    -> association-rule training
    -> RecommendationRule records
    -> current cart SKU input
    -> recommendation API
    -> storefront widget
```

The app is intended for one merchant/shop at a time. It is not a marketplace and should not compare products or prices across unrelated shops.

The planned product comparison feature is for comparing two different products inside the same shop, for example:

```text
Blue jacket vs red jacket
- price
- colors
- sizes
- material
- extracted features from description
- stock
- product attributes
```

## 2. Important Project Locations

### Backend and recommendation logic

- `app/ai-logic.js`
  - Current rule-mining implementation.
  - `trainModelFromDb()` trains from database orders.
  - `getRecommendations()` is a small local helper.

- `app/routes/api.train.jsx`
  - Admin training endpoint.
  - Fetches Shopify orders when an Admin API object is available.
  - Reads CSV/imported orders from `OrderHistory`.
  - Trains rules and stores them in `RecommendationRule`.

- `app/routes/api.recommend.jsx`
  - Storefront recommendation endpoint.
  - Receives `shop`, `ids`, and `skus` query parameters.
  - Uses active rules for the current shop only.
  - Caches compiled rules for 30 seconds.
  - Matches all antecedent SKUs against the cart.
  - Scores candidates using confidence, support, cart-match ratio, and priority.
  - Returns up to three products in `products` and keeps the first result in `product` for backward compatibility.

### Admin UI

- `app/routes/app._index.jsx`
  - Home page.
  - `Train AI Model` button.
  - `Choose rules` modal.
  - Rule catalog search and product dropdowns.
  - Enable/disable/delete rules.
  - Set or update discount percentage for any rule, including model-generated rules.

- `app/routes/app.rules.jsx`
  - Older full rules page.
  - Has loader/action for listing, creating, and deleting rules.
  - The primary workflow is now the home-page modal, so do not rely on a `/app/rules` navigation link.

- `app/routes/app.jsx`
  - Embedded app layout and authentication.
  - Navigation currently exposes the Recommendations page.

### Storefront extension

- `extensions/ai-widget/blocks/ai-recommendations.liquid`
  - Current Theme App Block.
  - Renders the recommendation widget shell.
  - Uses `target: "section"`.
  - Adds the widget JavaScript asset.

- `extensions/ai-widget/assets/recommendations.js`
  - Reads `/cart.js`.
  - Sends cart SKUs to `/api/recommend`.
  - Displays loading, empty-cart, no-result, error, and recommendation states.
  - Supports the API `products` array and legacy `product` response.
  - Contains a temporary development Cloudflare URL in `DEV_URL`.
  - This URL changes whenever `shopify app dev` creates a new tunnel.

- `extensions/ai-widget/snippets/ai-recommendations.liquid`
  - Legacy manual snippet.
  - Do not render this at the same time as the app block.
  - A theme warning `OrphanedSnippet` is expected while this file remains unused.

### Database

- `prisma/schema.prisma`
  - `Session`: Shopify sessions.
  - `OrderHistory`: CSV and Shopify order transactions.
  - `RecommendationRule`: generated and merchant rules.

Current `RecommendationRule` fields include:

```text
shop
cartProducts       JSON string of antecedent SKUs
cartSize
suggestProduct
confidence
support
source            model or merchant
status            active or disabled
priority
discountPercent
updatedAt
```

Migrations include:

- `20251213203025_init_local`
- `20251215113630_add_order_history`
- `20261021233117_add_rule_controls`

## 3. Current Algorithm

The project does not currently use K-Means or Random Forest.

The current method is custom association-rule mining, approximately an Apriori-like implementation.

`trainModelFromDb()`:

1. Parses the product SKU array in each order.
2. Deduplicates and sorts items.
3. Skips orders with fewer than two products or more than `maxItemsPerOrder`.
4. Counts singleton, pair, and triple itemsets.
5. Creates directional rules by removing one item from an itemset.
6. Calculates confidence:

```text
confidence(A -> B) = support(A and B) / support(A)
```

For a triple, the implementation can produce rules such as:

```text
A + B -> C
```

The current training algorithm is not yet FP-Growth, Eclat, PrefixSpan, supervised ML, or deep learning.

Recent improvements are serving/ranking improvements, not a new training algorithm:

- Rule cache
- Top-K candidate aggregation
- Candidate scoring
- Shop isolation
- Priority support
- Active/disabled status
- Merchant overrides

## 4. Current Data and Demo State

A sample CSV was imported into the local SQLite database:

```text
Orders imported: 18,338
Generated rules: about 51,083
```

The CSV dataset uses StockCode values. Shopify product variants must have matching SKUs for the recommendation API to find the product.

The current local database is normally:

```text
my-plugin-ai/prisma/dev.sqlite
```

The local `.env` contains a non-secret database setting:

```env
DATABASE_URL="file:./dev.sqlite"
```

Never commit or write Shopify API secrets into this handoff file.

## 5. How to Install and Run

### Requirements

The project package specifies:

```text
Node >= 20.19 < 22
or Node >= 22.12
```

Node 24 also satisfies the second condition, although Node 22 LTS is the safer project choice.

### First setup

PowerShell previously blocked `npm.ps1` and `shopify.ps1`. The current machine used this policy fix once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Alternatively, use `.cmd` commands without changing policy:

```powershell
npm.cmd
shopify.cmd
```

Install dependencies:

```powershell
cd C:\Users\giang\ai-app-shopify\my-plugin-ai
npm.cmd ci
npm.cmd run setup
```

`npm.cmd run setup` runs:

```text
prisma generate
prisma migrate deploy
```

### Start development

Always run from the app directory, not the workspace parent:

```powershell
cd C:\Users\giang\ai-app-shopify\my-plugin-ai
shopify.cmd app dev
```

Keep this terminal open.

Shopify CLI may ask for:

- Shopify Partner login
- Development store selection
- Storefront password

The storefront password is not the Partner password or API secret. It is managed at:

```text
Online Store -> Preferences -> Password protection
```

When ready, CLI prints:

```text
Ready, watching for changes in your app
```

It also prints:

- App Preview URL
- Theme Editor URL
- Local React Router URL
- Temporary Cloudflare URL

The Cloudflare URL is ephemeral. It may change or stop resolving when the dev process ends. Update `DEV_URL` in `extensions/ai-widget/assets/recommendations.js` when testing the storefront after a new tunnel is created.

### Stop development

In the same terminal:

```text
Ctrl + C
```

## 6. How to Test as Admin

1. Run `shopify.cmd app dev`.
2. Open the App Preview URL from the CLI.
3. Use `Train AI Model` to train rules.
4. Use `Choose rules` to open the modal.
5. The modal supports:
   - Searching products by name or SKU.
   - Selecting product A as a cart trigger.
   - Optionally selecting product B as a second cart trigger.
   - Selecting the recommended product C.
   - Setting priority.
   - Setting discount percentage.
   - Enabling/disabling rules.
   - Deleting rules.
   - Updating discount for model-generated rules.

Rule semantics:

```text
Cart trigger A -> recommendation C
Cart trigger A + B -> recommendation C
```

`Search product catalog` only filters the dropdown options. It is not itself a rule condition.

## 7. How to Test as Customer

The customer storefront is:

```text
https://my-ai-shop-test.myshopify.com
```

Cart URL:

```text
https://my-ai-shop-test.myshopify.com/cart
```

Steps:

1. Ensure `shopify app dev` is still running.
2. Ensure the `AI recommendations` app block is enabled in the theme.
3. Add products with matching SKUs to the cart.
4. Open `/cart`.
5. Refresh with `Ctrl + F5`.
6. Inspect browser DevTools Console if the widget shows an error.

The widget displays visible status messages for loading, empty cart, no recommendation, and API errors.

Do not add both the legacy `AI Recommendations Widget` from the old app and the current `AI recommendations` block. The old app is `my plugin ai`; the current project app is `SmartCart RCM` (handle `smartcart-rcm`, formerly `plugin-app-fix1`).

## 8. Known Warnings and Caveats

### OrphanedSnippet

Theme Check may show:

```text
OrphanedSnippet
```

This refers to the old unused snippet under `extensions/ai-widget/snippets`. It is not the current app block.

### Unused Frame warning

Build may warn that `Frame` is imported but unused in `app/routes/app.jsx`. This does not block the build and can be cleaned later.

### Prisma EPERM

Running full `npm run build` while the dev server is active can fail because Prisma's Windows query engine file is locked. To validate routes without regenerating Prisma:

```powershell
cd C:\Users\giang\ai-app-shopify\my-plugin-ai
.\node_modules\.bin\react-router.cmd build
```

To run full build, stop the dev server first.

### Authentication and training

The current training route still contains prototype behavior around authentication and demo CSV data. It can fall back to unauthenticated admin access in the current dev setup. This must be tightened before production:

- Always derive shop from authenticated session.
- Do not trust `shop` query parameter for destructive operations.
- Remove cross-shop demo fallback in production.
- Do not allow unauthenticated users to trigger training or delete rules.

### Training is synchronous

Current training runs inside one HTTP request:

```text
Fetch Shopify orders -> store orders -> mine rules -> replace rules -> response
```

This is acceptable for the prototype but not production-scale.

## 9. Planned Graduation Project Roadmap

### A. Better recommendation algorithms

Keep the current implementation as a baseline and add:

1. Apriori baseline with full metrics.
2. FP-Growth for faster frequent-itemset mining.
3. Eclat as an alternative vertical-format miner.
4. Popularity fallback.
5. Item-to-item similarity using Jaccard or cosine similarity.
6. Weighted rules using recency, order value, or margin.
7. Sequential mining for purchase order/time behavior.
8. Hybrid ranking.

Useful metrics:

```text
support
confidence
lift
leverage
conviction
Precision@K
Recall@K
HitRate@K
NDCG@K
coverage
add-to-cart rate
purchase conversion rate
```

### B. Strategy profiles

The merchant should select a business objective, not an algorithm name:

```text
High precision
Broad coverage
Cart expansion
Recent behavior
High revenue
New product discovery
```

Each profile can map internally to different algorithms and ranking weights.

### C. Training jobs and schedules

Add models such as:

```text
TrainingJob
- shop
- status
- requestedBy
- startedAt
- finishedAt
- error
- modelVersion
```

```text
RecommendationModel
- shop
- version
- status: draft/active/archived
- strategyProfile
- metrics
- createdAt
```

Training should become:

```text
Manual/weekly/monthly trigger
    -> queued job
    -> worker
    -> draft model
    -> evaluate
    -> atomically publish active model
```

Never delete active rules before the replacement model is fully trained and validated.

### D. Discount implementation

`discountPercent` is currently stored and returned as metadata only.

To apply a real discount at checkout, add a Shopify Discount Function. It should validate:

- Cart contains A and optionally B.
- Discount percentage.
- Valid time window.
- Product/variant scope.
- Discount stacking rules.
- Currency and market behavior.

### E. Product suppression

For a same-shop customer preference feature, add per-session or per-customer feedback:

```text
ProductFeedback
- shop
- sessionId/customerId
- productId
- event: view/skip/dismiss/not_interested
- createdAt
- expiresAt
```

Do not globally hide a product family merely because one customer skipped one item. Use category/tags/attributes/embedding similarity, TTL, and reset.

### F. Compare two products in the same shop

This is different from cross-shop marketplace comparison.

Add:

```text
ProductCatalog
- shop
- productId
- variantId
- sku
- title
- barcode
- vendor
- category
- price
- availability
```

Extract normalized attributes from descriptions:

```text
HTML description
    -> clean HTML
    -> split text
    -> normalize attributes
    -> ProductAttribute records
    -> comparison table
```

Compare:

- Price
- Sale price
- Availability
- Color
- Size
- Material
- Features
- Rating and review count
- Extracted description attributes

## 10. Recommended Next Implementation Order

1. Tighten training authentication and remove hard-coded shop fallback.
2. Add model/rule versioning and atomic publish.
3. Move training to a background job.
4. Add FP-Growth and compare against current baseline.
5. Add lift and offline evaluation metrics.
6. Implement strategy profiles.
7. Implement Shopify Discount Function.
8. Add recommendation event tracking.
9. Add customer suppression/reset.
10. Build same-shop product comparison.

## 11. Handoff Prompt

Use this prompt in a new AI conversation:

```text
Read docs/AI_HANDOFF.md first. Continue this Shopify recommendation app from its current repository state. Do not reset existing changes. Preserve the current API response compatibility and shop isolation. Before editing, inspect the current files and state one local hypothesis plus a focused validation. Implement the next roadmap item with minimal scoped changes, then build/test it.
```
