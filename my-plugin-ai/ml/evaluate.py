"""Offline evaluation of the recommenders ("try the system 1000 times and measure").

Protocol (basket completion on a time split):
  1. Orders are sorted by date; the oldest 80% train every model, the newest 20% are test orders.
  2. For each sampled test order (>= 2 known items), a random half of its items (at most
     --max-cart) is the cart; the other items are the hidden targets the customer really bought.
  3. Each model recommends K items for the cart; we measure how many hidden items it finds.
  4. Steps 2-3 are repeated with several random seeds; results are mean +- std.

Metrics @K: HitRate (at least one hidden item found), Precision, Recall, NDCG, MRR,
plus coverage (share of the catalogue ever recommended), answer rate (cases with any
recommendation), fit time and mean time per recommendation.

Usage:
  python ml/evaluate.py --csv data/data.csv --cases 1000 --repeats 3
  python ml/evaluate.py --json export.json            # data exported by the app
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from data import load_orders_csv, load_orders_json, summary, time_split  # noqa: E402
from dec import DEC  # noqa: E402
from recommenders import Apriori, FPGrowth, Hybrid, ItemKNN, Popularity  # noqa: E402

# UCI Online Retail codes that are fees or adjustments, not products.
NON_PRODUCT_CODES = {"POST", "DOT", "M", "C2", "D", "S", "B", "CRUK", "PADS", "BANK CHARGES", "AMAZONFEE", "gift_0001_10", "gift_0001_20"}

MODELS = {
    "popularity": lambda: Popularity(),
    "apriori": lambda: Apriori(),
    "fpgrowth": lambda: FPGrowth(),
    "itemknn": lambda: ItemKNN(),
    "dec": lambda: DEC(),
    # Fusion of the three learned models; weights fixed in advance (precision-first).
    "hybrid": lambda: Hybrid([FPGrowth(), ItemKNN(), DEC()], weights=[1.0, 0.5, 0.5]),
}


def make_cases(test_orders, known_items, n_cases, max_cart, seed):
    rng = random.Random(seed)
    eligible = []
    for order in test_orders:
        items = [item for item in order.items if item in known_items]
        if len(items) >= 2:
            eligible.append(items)
    rng.shuffle(eligible)
    cases = []
    for items in eligible[:n_cases]:
        items = items[:]
        rng.shuffle(items)
        cart_size = max(1, min(max_cart, len(items) // 2))
        cases.append((items[:cart_size], set(items[cart_size:])))
    return cases


def score_case(recommended, targets, k):
    top = recommended[:k]
    hits = [1 if item in targets else 0 for item in top]
    dcg = sum(hit / math.log2(rank + 2) for rank, hit in enumerate(hits))
    ideal = sum(1 / math.log2(rank + 2) for rank in range(min(len(targets), k)))
    first = next((rank for rank, hit in enumerate(hits) if hit), None)
    return {
        "hit": float(any(hits)),
        "precision": sum(hits) / k,
        "recall": sum(hits) / len(targets),
        "ndcg": dcg / ideal if ideal else 0.0,
        "mrr": 1 / (first + 1) if first is not None else 0.0,
    }


def evaluate(model, cases, ks, catalogue_size):
    totals = {k: {m: 0.0 for m in ("hit", "precision", "recall", "ndcg", "mrr")} for k in ks}
    recommended_items = set()
    answered = 0
    start = time.perf_counter()
    for cart, targets in cases:
        recommended = model.recommend(cart, max(ks))
        answered += bool(recommended)
        recommended_items.update(recommended[: max(ks)])
        for k in ks:
            for metric, value in score_case(recommended, targets, k).items():
                totals[k][metric] += value
    elapsed = time.perf_counter() - start
    n = max(len(cases), 1)
    result = {f"{metric}@{k}": totals[k][metric] / n for k in ks for metric in totals[k]}
    result["coverage"] = len(recommended_items) / catalogue_size
    result["answer_rate"] = answered / n
    result["ms_per_recommendation"] = 1000 * elapsed / n
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--csv", help="raw order lines (UCI Online Retail layout by default)")
    parser.add_argument("--json", help="dataset exported by the app")
    parser.add_argument("--models", default=",".join(MODELS))
    parser.add_argument("--cases", type=int, default=1000, help="test baskets per repeat")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--max-cart", type=int, default=5)
    parser.add_argument("--test-ratio", type=float, default=0.2)
    parser.add_argument("--out", default="docs/eval")
    args = parser.parse_args()

    orders = load_orders_json(args.json) if args.json else load_orders_csv(args.csv or "data/data.csv")
    orders = [
        type(o)(o.id, o.date, tuple(i for i in o.items if i not in NON_PRODUCT_CODES)) for o in orders
    ]
    orders = [o for o in orders if o.items]
    train, test = time_split(orders, args.test_ratio)
    known = {item for o in train for item in o.items}
    print("train", summary(train), "\ntest ", summary(test), flush=True)

    ks = (5, 10)
    rows = []
    for name in args.models.split(","):
        model = MODELS[name]().fit(train)
        per_repeat = [
            evaluate(model, make_cases(test, known, args.cases, args.max_cart, seed), ks, len(known))
            for seed in range(args.repeats)
        ]
        row = {"model": name, "fit_seconds": round(model.fit_seconds, 2)}
        for metric in per_repeat[0]:
            values = np.array([r[metric] for r in per_repeat])
            row[metric] = round(float(values.mean()), 4)
            row[f"{metric}_std"] = round(float(values.std()), 4)
        rows.append(row)
        print(f"{name:10s} HR@10={row['hit@10']:.4f}  P@10={row['precision@10']:.4f}  R@10={row['recall@10']:.4f}  "
              f"NDCG@10={row['ndcg@10']:.4f}  MRR@10={row['mrr@10']:.4f}  cov={row['coverage']:.3f}  "
              f"answer={row['answer_rate']:.3f}  fit={row['fit_seconds']}s", flush=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    meta = {
        "protocol": "time split, half-basket completion",
        "test_ratio": args.test_ratio,
        "cases_per_repeat": args.cases,
        "repeats": args.repeats,
        "max_cart": args.max_cart,
        "train": summary(train),
        "test": summary(test),
    }
    (out / "results.json").write_text(json.dumps({"meta": meta, "results": rows}, indent=2), encoding="utf-8")
    with open(out / "results.csv", "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    plot(rows, out)
    print(f"Saved {out / 'results.json'}, results.csv and charts", flush=True)


def plot(rows, out):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    metrics = ["hit@10", "precision@10", "recall@10", "ndcg@10", "mrr@10"]
    names = [row["model"] for row in rows]
    x = np.arange(len(metrics))
    width = 0.8 / len(rows)
    fig, ax = plt.subplots(figsize=(10, 4.5))
    for index, row in enumerate(rows):
        values = [row[m] for m in metrics]
        errors = [row[f"{m}_std"] for m in metrics]
        ax.bar(x + index * width, values, width, yerr=errors, capsize=3, label=row["model"])
    ax.set_xticks(x + width * (len(rows) - 1) / 2, [m.upper() for m in metrics])
    ax.set_ylabel("score (higher is better)")
    ax.set_title("Offline evaluation: basket completion on the newest 20% of orders")
    ax.legend()
    fig.tight_layout()
    fig.savefig(out / "metrics_at_10.png", dpi=150)

    fig, ax = plt.subplots(figsize=(6, 4))
    ax.scatter([row["coverage"] for row in rows], [row["hit@10"] for row in rows])
    for row, name in zip(rows, names):
        ax.annotate(name, (row["coverage"], row["hit@10"]), textcoords="offset points", xytext=(5, 5))
    ax.set_xlabel("catalogue coverage")
    ax.set_ylabel("HitRate@10")
    ax.set_title("Accuracy vs. coverage")
    fig.tight_layout()
    fig.savefig(out / "accuracy_vs_coverage.png", dpi=150)


if __name__ == "__main__":
    main()
