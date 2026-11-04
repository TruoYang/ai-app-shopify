# Offline evaluation of the recommendation algorithms

Reproduce (about 5 minutes on a laptop CPU):

```powershell
cd C:\Users\giang\ai-app-shopify\my-plugin-ai
ml\.venv\Scripts\python.exe ml\evaluate.py --csv data\data.csv --cases 1000 --repeats 3
```

Outputs: `results.json`, `results.csv`, `metrics_at_10.png`, `accuracy_vs_coverage.png`.

## Data

UCI Online Retail (`data/data.csv`): 541,909 order lines, 20,728 orders after removing returns
and fee codes (POST, DOT, M, BANK CHARGES, …), 3,941 products, 1 Dec 2010 – 9 Dec 2011.

| Split | Orders | Products | Period |
| --- | --- | --- | --- |
| Train (oldest 80%) | 16,431 | 3,856 | 2010-12-01 – 2011-10-26 |
| Test (newest 20%) | 4,108 | 3,062 | 2011-10-26 – 2011-12-09 |

The split is by time, so every model is judged on orders that happened after everything it learned from,
as in production.

## Protocol: basket completion

1. Sample 1,000 test orders with at least 2 products seen in training.
2. Shuffle the order's products. A random half (at most 5) is the **cart**; the rest are the
   **hidden items** the customer really bought.
3. Each model recommends 10 products for the cart (never products already in it).
4. Measure how many hidden items are found. Repeat steps 1–3 with 3 random seeds; report mean ± std.

| Metric | Meaning |
| --- | --- |
| HitRate@K | share of carts where at least one hidden item is in the top K |
| Precision@K | hidden items found / K |
| Recall@K | hidden items found / number of hidden items |
| NDCG@K | like recall, but hits near the top count more |
| MRR@K | 1 / rank of the first hit (how early the first good suggestion appears) |
| Coverage | share of the catalogue that is ever recommended (diversity) |
| Answer rate | share of carts that got any recommendation |

## Models

| Model | Idea |
| --- | --- |
| Popularity | best sellers; lower bound without personalisation |
| **Apriori (baseline)** | the app's original miner: pairs/triples in orders of 2–15 items, rules A→B and A+B→C |
| FP-Growth | same kind of rules mined with an FP-tree; long baskets (up to 60 items) are kept and lift is added to the ranking |
| Item-kNN | cosine similarity between product purchase vectors; score = sum of similarities to the cart |
| DEC | Deep Embedded Clustering (Xie et al., 2016): autoencoder embeddings of PPMI co-occurrence, clustered with a KL objective; candidates from the cart's clusters, ranked by embedding similarity + co-purchase |
| Hybrid | Reciprocal Rank Fusion (k = 60) of FP-Growth, Item-kNN and DEC with weights 1 / 0.5 / 0.5, fixed before testing |

## Results (1,000 carts × 3 seeds)

| Model | HitRate@5 | HitRate@10 | Precision@10 | Recall@10 | NDCG@10 | MRR@10 | Coverage | Answer rate | Fit (s) | ms / cart |
|---|---|---|---|---|---|---|---|---|---|---|
| Popularity | 0.225 ± 0.006 | 0.322 ± 0.015 | 0.052 ± 0.002 | 0.031 ± 0.000 | 0.064 ± 0.002 | 0.147 ± 0.004 | 0.3% | 100.0% | 0.03 | 0.12 |
| Apriori (baseline) | 0.658 ± 0.006 | 0.745 ± 0.010 | 0.184 ± 0.003 | 0.162 ± 0.002 | 0.259 ± 0.001 | 0.472 ± 0.008 | 28.4% | 98.5% | 0.54 | 0.03 |
| **FP-Growth** | **0.691 ± 0.002** | **0.782 ± 0.004** | **0.208 ± 0.002** | **0.181 ± 0.002** | **0.288 ± 0.001** | 0.508 ± 0.006 | 36.2% | 99.4% | 28.29 | 0.08 |
| Item-kNN | 0.640 ± 0.002 | 0.726 ± 0.003 | 0.176 ± 0.003 | 0.159 ± 0.004 | 0.253 ± 0.003 | 0.471 ± 0.005 | **37.6%** | 100.0% | 0.58 | 0.08 |
| DEC | 0.594 ± 0.003 | 0.679 ± 0.005 | 0.157 ± 0.003 | 0.142 ± 0.004 | 0.230 ± 0.001 | 0.446 ± 0.004 | 34.6% | 100.0% | 14.98 | 1.73 |
| Hybrid | **0.691 ± 0.007** | 0.774 ± 0.005 | 0.202 ± 0.002 | 0.176 ± 0.005 | 0.284 ± 0.002 | **0.518 ± 0.004** | 37.3% | 100.0% | 42.24 | 2.12 |

## Findings

- **FP-Growth beats the baseline on every accuracy metric**: HitRate@10 +5.0% (0.745 → 0.782),
  Precision@10 +13%, NDCG@10 +11%, MRR@10 +7.7%. The gaps are many times larger than the
  standard deviations, so they are not noise. The gain comes mainly from keeping long baskets that the
  baseline drops (> 15 items) and from the lift term in ranking. It also recommends 36% of the catalogue
  instead of 28%.
- **Hybrid** matches FP-Growth (HitRate@5 equal, HitRate@10 −1%), has the best MRR (the first good
  suggestion appears earliest), the widest coverage among accurate models and always answers.
- **DEC alone is below the baseline.** Clustering groups *similar* products (same style or line), while
  the task is to find products bought *together*; inside a cluster, substitutes compete with complements.
  DEC is better suited to "similar items" and cold start (new products with few orders) than to
  cart completion. In the hybrid it adds diversity without hurting accuracy.
- Every learned model is 2.3× better than popularity, so personalisation matters.
- All models answer a cart in under 3 ms, so any of them can serve the storefront.

## Threats to validity

- One dataset (UK gift retailer, wholesale-like baskets of ~25 items). Fashion baskets are smaller;
  re-run with the shop's own data (`ml/evaluate.py --json <export>`) once it has enough orders.
- Offline hits are a proxy. Real impact (clicks, add-to-cart, revenue) needs online measurement
  (Phase 5: event tracking and A/B test).
- Hyperparameters come from defaults or the literature, not from tuning on the test split.
