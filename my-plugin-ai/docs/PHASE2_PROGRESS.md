# Phase 2 progress

Resume prompt: "tiếp tục Phase 2, đọc docs/PHASE2_PROGRESS.md". Work one step at a time; tick a step only after it is verified.

Base commit: `7c00a54 big update store - new store`.

## Steps

- [x] 1. Train keeps merchant rules (only replaces `source = "model"` rules); remove hard-coded dev shop and the `imported-from-csv` cross-shop fallback.
- [x] 2. Base-product matching: variant SKU `AUR-TOP-8558-M` counts as base `AUR-TOP-8558` (rules, cart, "already in cart").
- [x] 3. Per-item recommendations: quota by cart size (1 item: 5, 2: 3 each, 3–4: 2 each, 5+: 1 each), total cap, dedupe; combined rules (A+B→D) get a bonus.
- [x] 4. Widget keeps 1–2 earlier suggestions when the cart changes; per-SKU browser cache; render from cache, refresh in background; listen to cart changes from the drawer.
- [x] 5. Fallback when no rule matches: same category → items from latest orders → best sellers; home page with empty cart shows best sellers / new arrivals.
- [x] 6. Widget UI: product cards matching Horizon, compare-at price, Add to cart (updates drawer), editable heading, product page block.
- [x] 7. Cleanup: delete `app/routes/apps.default-app-home.apps.ai.recommend.jsx` after a dev restart, remove orphaned snippet.

## Notes

- Dev store: `my-favsion.myshopify.com` (storefront password in `.env`-free memory of the user: ask if needed).
- Widget calls `/apps/ai/recommend` through the app proxy (`app/routes/apps.ai.recommend.jsx`, logic in `app/recommendations.server.js`).
- Theme copy in `store-theme/`; app block type `shopify://apps/smartcart-rcm/blocks/ai-recommendations/01a1988b-57d8-71f5-a4d5-4f5cfacab99e`.
- Changing extension JS/Liquid needs `shopify app deploy` (user runs it) for the live theme to pick it up.
- Steps 2–3 live in `app/catalog.server.js` (product keys = common SKU prefix, catalog cached 10 min) and `app/recommendations.server.js`; training maps SKUs to product keys too.
- Test data for widget work: OrderHistory rows `test_*` + model rules for `my-favsion` (tee AUR-TOP-47280, jeans AUR-BTM-16921, shoes AUR-SHO-4733...). Remove before Phase 3: scratch script `rec-test.mjs cleanup` or `deleteMany({ where: { shop, orderId: { startsWith: "test_" } } })` plus model rules.
- Steps 4 and 6 verified server-side and in rendered HTML (home, product, cart). Not yet clicked through in a real browser: Add to cart → drawer update, kept suggestions after cart change, instant render from sessionStorage.
- Product page widget section `ai_recommendations_product` added to `store-theme/templates/product.json` (pushed live).
- Old snippet and thumbs-up.png removed from the extension; only the alias route of step 7 is left (delete after the next `shopify app dev` restart).
- While `shopify app dev` runs, the live storefront serves the dev extension; run `shopify app deploy` (user) before stopping dev for good.
- Phase 2 test data removed in Phase 3 step 6.
