"""Train one recommender on the dataset exported by the app and write its rules.

Called by app/routes/api.train.jsx:
  python ml/train.py --input dataset.json --algorithm fpgrowth --output rules.json

Output: {"algorithm", "fit_seconds", "orders", "rules": [{cart, suggest, confidence, support, score}]}
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from data import load_orders_json  # noqa: E402
from recommenders import Apriori, FPGrowth, Hybrid, ItemKNN  # noqa: E402


def build(name: str):
    if name in ("dec", "hybrid"):
        from dec import DEC  # torch is only imported when DEC is used

        if name == "hybrid":
            return Hybrid([FPGrowth(), ItemKNN(), DEC()], weights=[1.0, 0.5, 0.5])
        return DEC()
    return {"apriori": Apriori, "fpgrowth": FPGrowth, "itemknn": ItemKNN}[name]()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--algorithm", default="fpgrowth", choices=["apriori", "fpgrowth", "itemknn", "dec", "hybrid"])
    parser.add_argument("--output", required=True)
    parser.add_argument("--per-item", type=int, default=10, help="rules kept per antecedent")
    parser.add_argument("--max-rules", type=int, default=50000, help="cap on rules written for the shop")
    args = parser.parse_args()

    orders = load_orders_json(args.input)
    model = build(args.algorithm).fit(orders)
    rules = model.to_rules(per_item=args.per_item)
    # The app loads every active rule per request: keep all single-item rules first, then the
    # best two-item rules, up to --max-rules.
    singles = [rule for rule in rules if len(rule["cart"]) == 1]
    pairs = sorted((rule for rule in rules if len(rule["cart"]) > 1), key=lambda rule: -rule["score"])
    rules = (sorted(singles, key=lambda rule: -rule["score"]) + pairs)[: args.max_rules]
    result = {
        "algorithm": args.algorithm,
        "fit_seconds": round(model.fit_seconds, 2),
        "orders": len(orders),
        # Plain Python types: numpy scalars are not JSON serialisable.
        "rules": [
            {
                "cart": [str(item) for item in rule["cart"]],
                "suggest": str(rule["suggest"]),
                "confidence": float(rule["confidence"]),
                "support": int(rule["support"]),
                "score": float(rule["score"]),
            }
            for rule in rules
        ],
    }
    Path(args.output).write_text(json.dumps(result), encoding="utf-8")
    print(json.dumps({key: value for key, value in result.items() if key != "rules"} | {"rules": len(rules)}))


if __name__ == "__main__":
    main()
