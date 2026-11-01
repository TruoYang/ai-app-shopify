# Roadmap and agreed decisions

Last updated: 2026-11-02. This file complements `AI_HANDOFF.md` and records what the project owner decided.

## Decisions

| Topic | Decision |
| --- | --- |
| Demo store | New development store, fashion theme (clothes, shoes, hats, bags, accessories). Built with `scripts/catalog`, see `SETUP_FASHION_STORE.md`. |
| Training data | Two sources: imported CSV order history and real Shopify orders. |
| CSV import | Preview table where the merchant assigns a role to each column (order ID, SKU, name, quantity, date, …). After import, a separate low-traffic page matches each CSV product to exactly one shop product (1-1). |
| Algorithms | Python. Compare Apriori (current baseline), FP-Growth, item-kNN, and DEC (deep embedded clustering) as the deep-learning contribution. |
| Ranking priority | Merchant chooses what to favour: revenue, quantity sold, or interaction. |
| Evaluation | Offline: leave-one-out on a time-based train/test split, HitRate/Precision/Recall/NDCG@K, MRR, coverage. Online: event tracking (impression, click, add to cart, purchase). |
| Auto-update rules | None / weekly / monthly (never daily) plus a training date window, so old orders (for example from 2020) are excluded. |
| Cart behaviour | See "Cart recommendations" below. |
| Category / image recommendations | Category first. Image similarity last, only if everything else works. |
| Widgets | Cart page and product page. Add an "Add to cart" button. |
| Languages | Admin app only: Vietnamese and English (follow Shopify admin locale, with a manual switch). |
| Flow documents | English, plus a Vietnamese copy. |
| Hosting | Deploy to the web so the Cloudflare tunnel is no longer needed; low, preferably one-off cost (option to be chosen). |

## Cart recommendations (new behaviour)

1. Scan every item in the cart and recommend per item (1-1), not only from the whole-cart rule.
2. Per-item quota depends on cart size. For example:
   - 1 item: 5 suggestions.
   - 2 items: 3 suggestions each.
   - 3–4 items: 2 suggestions each.
   - 5 or more: 1 suggestion each.

   Total is capped and duplicates are removed.
3. Combined rules (A + B gives D) still apply and get a bonus.
4. Keep 1–2 earlier suggestions when the cart changes (cart A gives B; after adding C, show D **and** B), unless B has been added to the cart.
5. Cache per SKU in the browser and render instantly from the cache. Refresh in the background and only replace the list once new results arrive. No more empty state while loading.
6. Fallback when no rule matches: same category, then items from the most recent orders, then best sellers.

## Phases

1. **Demo fashion store.** Done: catalog builder and seeding scripts.
2. **Core fixes and widget experience:**
   - Training no longer deletes merchant rules or edited discounts.
   - Variant SKU maps to base product.
   - Cart behaviour above.
   - Product page widget and add-to-cart button.
   - App Proxy instead of the hard-coded tunnel URL.
3. **Data:** CSV import wizard with column mapping, product matching page, training date window.
4. **Algorithms and evaluation:**
   - Python training worker.
   - Apriori, FP-Growth, item-kNN, DEC.
   - Offline evaluation report.
   - Merchant priority weights.
   - Weekly/monthly schedule.
   - Versioned rules with atomic publish.
5. **Measurement:** recommendation event tracking, merchant dashboard, A/B test between two algorithms.
6. **Production:**
   - VI/EN admin.
   - Shopify Discount Function.
   - Training authentication hardening.
   - GDPR webhooks.
   - Postgres.
   - Deployment.
7. **Documentation:** system flow diagrams (Mermaid, English and Vietnamese) for the report. Updated as each phase lands.
