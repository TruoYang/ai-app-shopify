# Online measurement and A/B test (Phase 5)

How the app measures whether recommendations help, and the result of the replay A/B test.
Flow diagram: [`../flows/README.md`](../flows/README.md#7-measurement-and-ab-test).

## 1. What is measured

The storefront widget sends events to `/apps/ai/event` through the App Proxy. Purchases come from the `orders/paid` webhook.

| Event | When |
|---|---|
| impression | the widget is at least 30% on screen; once per distinct list per page view |
| click | the shopper opens a suggested product |
| add_to_cart | the shopper adds a suggestion ("Add to cart" or "Add all") |
| purchase | an order is paid and comes from a widget visitor or contains a line added from the widget |

**Attribution** (works like an affiliate link):

- Each browser gets an anonymous visitor id (random, stored in localStorage). No personal data is used.
- The widget writes the visitor id into the cart attribute `_smartcart_visitor`.
- A product counts as sold through the widget in either of two cases:
  - **Added:** added with the widget's button. The line gets the hidden property `_smartcart_rcm`.
  - **Clicked:** opened from the widget, then bought within **24 hours**, even if it was added on its product page. The widget keeps the product ids clicked in the last 24 hours in the cart attribute `_smartcart_clicked`.
- The orders/paid webhook reads both. "Revenue from suggestions" = added + clicked. The split is stored and shown on the dashboard.

**Two different revenue numbers:**

| Number | Meaning | Like |
|---|---|---|
| Revenue from suggestions | Everything sold through the widget, including products the shopper might have bought anyway | Affiliate commission base (last-click attribution) |
| Revenue added by the app | What the AI brought on top of the control group (best sellers): (revenue per AI visitor − revenue per control visitor) × AI visitors, with a 95% interval | Incremental revenue from an A/B test |

**Metrics per visitor** (one visitor counts once):

- **Click rate:** visitors who clicked a suggestion / visitors who saw the widget.
- **Add-to-cart rate:** visitors who added a suggestion / visitors who saw the widget.
- **Revenue from suggestions per visitor.**
- **Click-through rate (CTR) per shown product** (dashboard only): clicks / products shown.

## 2. A/B test design

- **Groups:**
  - **AI:** trained rules plus fallbacks, as normally served.
  - **Control:** best sellers only. This is the usual non-personalised baseline.
- **Assignment:**
  - Group = hash(visitor id + experiment start) mod 100, compared with the control share (10–50%).
  - A visitor stays in the same group on every visit.
  - The group is computed on the server, so a shopper cannot choose it.
- **Statistics:**
  - Two-proportion z-test (two-sided, α = 0.05).
  - 95% confidence interval of the difference.
  - Visitors needed per group for 80% power (`app/ab-stats.js`).
- **Merchant controls:** the Insights page (`/app/insights`) turns the live test on or off and sets the control share. Live numbers count from the experiment start.

## 3. Replay simulation

The demo shop has no real traffic, so live A/B data would stay empty. The replay (`app/replay.server.js`) creates A/B data from real orders.

1. **Held-out orders:** orders after the end of the training window, so the model never saw them.
   - Without an end date, the newest 20% of orders are used. The result is then flagged as optimistic.
2. **One order = one visit:**
   - Half of the order's products (max 5) are the cart.
   - The other products are what the shopper "really bought".
3. **Group:** each visit goes to a group at random (50/50). Suggestions come from the same `recommendForCart` code as the live widget.
4. **Shopper model** (assumption, the same for both groups):
   - Click chance: 50% for a product the shopper really bought, 4% for any other product.
   - Both chances are multiplied by 1 / log2(position + 1).
   - Chance of adding to cart after a click: 80% for a real purchase, 15% otherwise.
   - A product added from the widget is always bought. Another product added from the widget is bought with 30% chance.
   - Without the widget, the shopper finds each product of their real order alone with 70% chance.
   - **Baseline:** the expected order of the same visit without any widget, i.e. the cart plus 70% of the value of the hidden products.
     - The visit's order value uses expected values too, not random draws. Otherwise the large differences between order sizes (average $820) hide the effect.
     - Revenue added per visitor = order value − baseline.
5. **Events** are saved with `simulated = true`. The dashboard and z-test treat them like live data.

Run it from the Insights page ("Run replay") or from the command line:

```powershell
node --import ./scripts/lib/register-app-imports.mjs scripts/demo/run-replay.mjs --shop my-favsion.myshopify.com --sessions 2000
```

## 4. Results (2026-11-17)

**Setup:**

- **Model:** FP-Growth (50,000 rules), trained only on orders up to 2011-10-25.
- **Held-out orders:** 3,389 orders from 2011-10-26 to 2011-12-09 with at least two matched products.
- **Visits:** 2,000 per run, 50/50 split, 6 products shown.

| Seed | Visitors AI / control | Click rate AI vs control | Add-to-cart rate AI vs control | Lift | 95% interval of difference | p-value | Revenue from suggestions per visitor |
|---|---|---|---|---|---|---|---|
| 1 | 1,029 / 971 | 36.6% vs 24.5% | 27.4% vs 13.2% | +108% | [+10.8, +17.7] pp | < 0.0001 | $17.51 vs $8.09 |
| 2 | 976 / 1,024 | 40.3% vs 22.6% | 28.3% vs 12.2% | +132% | [+12.6, +19.5] pp | < 0.0001 | $17.48 vs $8.68 |
| 3 | 986 / 1,014 | 38.1% vs 23.1% | 26.3% vs 12.1% | +117% | [+10.7, +17.5] pp | < 0.0001 | $17.88 vs $8.00 |
| 42 | 980 / 1,020 | 39.8% vs 26.7% | 28.7% vs 13.5% | +112% | [+11.6, +18.7] pp | < 0.0001 | $19.22 vs $9.30 |

CTR per shown product: about 8.3% for AI vs 4.7% for control.

**By suggestion type** (seed 42, both groups):

- Rule-based suggestions: CTR 8.6%.
- Best sellers: CTR 5.0%.

**A/A check (validity of the pipeline):**

- Setup: both groups get AI suggestions, 20 runs with seeds 101–120.
- Result: only 1 of 20 runs was significant at 5%, which is the expected false-positive rate.
- Meaning: the split and the z-test do not create differences on their own.

**Reading the result:**

- On orders the model had never seen, AI suggestions roughly double the share of visitors who add a suggestion to the cart compared with best sellers.
- The difference is far beyond chance (every 95% interval excludes 0).
- The size of the numbers depends on the shopper model. The direction comes from the data: AI suggestions contain products that were really bought together much more often (see HitRate in [`README.md`](README.md)).

**Revenue added by the app** (same fair setup, 2,000 visits per run):

| Seed | Added per visitor vs no widget: AI | Added per visitor vs no widget: best sellers | AI minus best sellers per visitor | 95% interval | p-value | Total for the AI group |
|---|---|---|---|---|---|---|
| 1 | $5.41 | $2.59 | +$2.82 | [+$1.90, +$3.74] | < 0.0001 | +$2,902 (1,029 visitors) |
| 2 | $5.53 | $2.94 | +$2.60 | [+$1.58, +$3.61] | < 0.0001 | +$2,535 (976 visitors) |
| 3 | $5.68 | $2.62 | +$3.06 | [+$2.09, +$4.03] | < 0.0001 | +$3,015 (986 visitors) |
| 42 | $6.01 | $3.18 | +$2.83 | [+$1.78, +$3.89] | < 0.0001 | +$2,778 (980 visitors) |

- **Effect of AI:** compared with a best-seller widget, AI suggestions roughly double the revenue the widget adds, about +$2.8 per visitor.
- **Relative to the whole order** (about $640), the effect is small, around 0.4%. This is realistic for a cross-sell widget.
- **A/A check on revenue:** 0 of 20 runs significant (seeds 101–120).
- **Without the baseline:** comparing raw order value instead of value − baseline gave no significant result in 3 of 3 runs (p = 0.06–1.0). The order-size noise is far larger than the effect.
  - So on live data, where no baseline exists, revenue uplift needs many visitors. The dashboard shows how many.

## 5. Limitations

- Replay traffic is simulated:
  - The shopper model is an assumption.
  - Real shoppers also see prices, images and the rest of the store.
- The revenue numbers depend on the shopper model, especially the 70% "find without help" rate.
  - If shoppers find everything alone, suggestions add no revenue.
  - If they rarely do, suggestions add more.
- Live A/B results need real visitors. For a 12% → 14% difference, about 4,400 visitors per group are needed (80% power). The dashboard shows this number for the observed rates.
- **Attribution limits:**
  - A click older than 24 hours, or made in another browser, is not linked to the order.
- "Revenue from suggestions" includes products the shopper might have bought anyway. Only the A/B comparison (AI vs control) measures the extra effect.
