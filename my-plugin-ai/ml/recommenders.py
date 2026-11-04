"""Recommenders compared in the offline evaluation.

All share one interface:
    fit(orders)                  learn from training orders
    recommend(cart, k)           top-k item keys for a cart (cart items are never returned)
    to_rules(per_item)           rules in the app's format, written to RecommendationRule

Rules: {"cart": [keys], "suggest": key, "confidence": float, "support": int, "score": float}.
"""

from __future__ import annotations

import math
import time
from collections import Counter, defaultdict
from itertools import combinations

import numpy as np
import pandas as pd
from scipy import sparse

from data import Order


class Recommender:
    name = "base"

    def fit(self, orders: list[Order]) -> "Recommender":
        start = time.perf_counter()
        self._fit(orders)
        self.fit_seconds = time.perf_counter() - start
        return self

    def _fit(self, orders: list[Order]) -> None:
        raise NotImplementedError

    def recommend(self, cart: list[str], k: int = 10) -> list[str]:
        raise NotImplementedError

    def to_rules(self, per_item: int = 10) -> list[dict]:
        raise NotImplementedError


class Popularity(Recommender):
    """Most purchased items. Lower bound: no personalisation at all."""

    name = "popularity"

    def _fit(self, orders):
        self.counts = Counter(item for order in orders for item in order.items)
        self.ranked = [item for item, _ in self.counts.most_common()]

    def recommend(self, cart, k=10):
        cart_set = set(cart)
        return [item for item in self.ranked if item not in cart_set][:k]

    def to_rules(self, per_item=10):
        return []


class RuleRecommender(Recommender):
    """Shared ranking for rule miners, the same scoring as app/recommendations.server.js."""

    def _index(self, rules):
        self.rules = rules
        self.by_antecedent = defaultdict(list)
        for rule in rules:
            self.by_antecedent[tuple(sorted(rule["cart"]))].append(rule)

    def recommend(self, cart, k=10):
        cart_set = set(cart)
        scores: dict[str, float] = {}
        antecedents = [(item,) for item in cart_set]
        antecedents += [tuple(sorted(pair)) for pair in combinations(cart_set, 2)] if len(cart_set) <= 30 else []
        for antecedent in antecedents:
            for rule in self.by_antecedent.get(antecedent, ()):
                if rule["suggest"] in cart_set:
                    continue
                scores[rule["suggest"]] = max(scores.get(rule["suggest"], 0.0), rule["score"])
        return [item for item, _ in sorted(scores.items(), key=lambda kv: -kv[1])[:k]]

    def to_rules(self, per_item=10):
        kept = []
        for rules in self.by_antecedent.values():
            kept.extend(sorted(rules, key=lambda r: -r["score"])[:per_item])
        return kept


def app_score(confidence: float, support: int, antecedent_size: int) -> float:
    """Same weights as ruleScore() in app/recommendations.server.js (priority 0)."""
    return confidence * 0.7 + min(support / 100, 1) * 0.2 + (0.15 if antecedent_size > 1 else 0.0)


class Apriori(RuleRecommender):
    """Baseline: the app's current miner (app/ai-logic.js trainModelFromDb).

    Counts single items, pairs and triples in orders of 2..15 items; rules A -> B and A + B -> C
    with support >= min_support and confidence >= min_confidence."""

    name = "apriori"

    def __init__(self, min_support=3, min_confidence=0.1, max_items_per_order=15):
        self.min_support = min_support
        self.min_confidence = min_confidence
        self.max_items_per_order = max_items_per_order

    def _fit(self, orders):
        counts = Counter()
        for order in orders:
            items = sorted(set(order.items))
            if len(items) < 2 or len(items) > self.max_items_per_order:
                continue
            counts.update((item,) for item in items)
            counts.update(combinations(items, 2))
            if len(items) >= 3:
                counts.update(combinations(items, 3))

        rules = []
        for itemset, support in counts.items():
            if len(itemset) < 2 or support < self.min_support:
                continue
            for index, suggest in enumerate(itemset):
                antecedent = itemset[:index] + itemset[index + 1:]
                base = counts.get(antecedent, 0)
                if not base:
                    continue
                confidence = support / base
                if confidence >= self.min_confidence:
                    rules.append({
                        "cart": list(antecedent),
                        "suggest": suggest,
                        "confidence": round(confidence, 4),
                        "support": support,
                        "score": app_score(confidence, support, len(antecedent)),
                    })
        self._index(rules)


class FPGrowth(RuleRecommender):
    """FP-Growth (mlxtend): the same kind of rules as Apriori, mined without candidate
    generation, so long baskets do not have to be dropped. Ranking adds lift."""

    name = "fpgrowth"

    def __init__(self, min_support_count=5, min_confidence=0.1, max_len=3, max_items_per_order=60):
        self.min_support_count = min_support_count
        self.min_confidence = min_confidence
        self.max_len = max_len
        self.max_items_per_order = max_items_per_order

    def _fit(self, orders):
        from mlxtend.frequent_patterns import association_rules, fpgrowth

        baskets = [sorted(set(o.items)) for o in orders if 2 <= len(set(o.items)) <= self.max_items_per_order]
        vocab = sorted({item for basket in baskets for item in basket})
        index = {item: i for i, item in enumerate(vocab)}
        rows = np.repeat(np.arange(len(baskets)), [len(b) for b in baskets])
        cols = np.fromiter((index[item] for basket in baskets for item in basket), dtype=np.int64)
        matrix = sparse.csr_matrix((np.ones(len(cols), dtype=bool), (rows, cols)), shape=(len(baskets), len(vocab)))
        frame = pd.DataFrame.sparse.from_spmatrix(matrix, columns=vocab)

        min_support = self.min_support_count / max(len(baskets), 1)
        itemsets = fpgrowth(frame, min_support=min_support, use_colnames=True, max_len=self.max_len)
        mined = association_rules(itemsets, metric="confidence", min_threshold=self.min_confidence)
        mined = mined[mined["consequents"].apply(len) == 1]

        n = len(baskets)
        rules = []
        for row in mined.itertuples(index=False):
            support = int(round(row.support * n))
            antecedent = sorted(row.antecedents)
            rules.append({
                "cart": antecedent,
                "suggest": next(iter(row.consequents)),
                "confidence": round(float(row.confidence), 4),
                "support": support,
                "lift": round(float(row.lift), 3),
                # Confidence first, lift breaks ties toward surprising (non-popular) items.
                "score": app_score(row.confidence, support, len(antecedent)) + 0.05 * math.log1p(row.lift),
            })
        self._index(rules)


class ItemKNN(Recommender):
    """Item-to-item collaborative filtering: cosine similarity between item purchase vectors.

    A candidate's score is the sum of its similarity to every cart item."""

    name = "itemknn"

    def __init__(self, neighbours=50, min_cooccurrence=2):
        self.neighbours = neighbours
        self.min_cooccurrence = min_cooccurrence

    def _fit(self, orders):
        baskets = [sorted(set(o.items)) for o in orders if o.items]
        self.vocab = sorted({item for basket in baskets for item in basket})
        self.index = {item: i for i, item in enumerate(self.vocab)}
        rows = np.repeat(np.arange(len(baskets)), [len(b) for b in baskets])
        cols = np.fromiter((self.index[item] for basket in baskets for item in basket), dtype=np.int64)
        matrix = sparse.csr_matrix((np.ones(len(cols), dtype=np.float32), (rows, cols)), shape=(len(baskets), len(self.vocab)))

        cooc = (matrix.T @ matrix).tocsr()
        counts = np.asarray(cooc.diagonal()).ravel()
        cooc.setdiag(0)
        cooc.eliminate_zeros()
        cooc.data[cooc.data < self.min_cooccurrence] = 0
        cooc.eliminate_zeros()
        norms = np.sqrt(np.maximum(counts, 1))
        sim = sparse.diags(1 / norms) @ cooc @ sparse.diags(1 / norms)
        self.counts = counts
        self.cooc = cooc

        self.neighbours_of: dict[int, list[tuple[int, float]]] = {}
        sim = sim.tocsr()
        for i in range(sim.shape[0]):
            start, end = sim.indptr[i], sim.indptr[i + 1]
            idx, vals = sim.indices[start:end], sim.data[start:end]
            if len(vals) > self.neighbours:
                top = np.argpartition(-vals, self.neighbours)[: self.neighbours]
                idx, vals = idx[top], vals[top]
            order = np.argsort(-vals)
            self.neighbours_of[i] = list(zip(idx[order].tolist(), vals[order].tolist()))

    def recommend(self, cart, k=10):
        cart_idx = {self.index[item] for item in cart if item in self.index}
        scores: dict[int, float] = defaultdict(float)
        for i in cart_idx:
            for j, value in self.neighbours_of.get(i, ()):
                if j not in cart_idx:
                    scores[j] += value
        return [self.vocab[j] for j, _ in sorted(scores.items(), key=lambda kv: -kv[1])[:k]]

    def to_rules(self, per_item=10):
        rules = []
        for i, neighbours in self.neighbours_of.items():
            for j, value in neighbours[:per_item]:
                together = int(self.cooc[i, j])
                rules.append({
                    "cart": [self.vocab[i]],
                    "suggest": self.vocab[j],
                    "confidence": round(together / max(self.counts[i], 1), 4),
                    "support": together,
                    "score": round(float(value), 4),
                })
        return rules


ALGORITHMS = {cls.name: cls for cls in (Popularity, Apriori, FPGrowth, ItemKNN)}


class Hybrid(Recommender):
    """Reciprocal Rank Fusion of several recommenders (Cormack et al., 2009).

    score(item) = sum over models of weight / (rrf_k + rank). rrf_k = 60 is the value from the
    original paper; it is fixed in advance, not tuned on the test orders."""

    name = "hybrid"

    def __init__(self, members, weights=None, rrf_k=60, depth=50):
        self.members = members
        self.weights = weights or [1.0] * len(members)
        self.rrf_k = rrf_k
        self.depth = depth

    def _fit(self, orders):
        for member in self.members:
            if not hasattr(member, "fit_seconds"):
                member.fit(orders)

    def recommend(self, cart, k=10):
        scores: dict[str, float] = defaultdict(float)
        for member, weight in zip(self.members, self.weights):
            for rank, item in enumerate(member.recommend(cart, self.depth)):
                scores[item] += weight / (self.rrf_k + rank + 1)
        return [item for item, _ in sorted(scores.items(), key=lambda kv: -kv[1])[:k]]

    def to_rules(self, per_item=10):
        vocab = sorted({item for member in self.members for rule in member.to_rules(per_item) for item in rule["cart"]})
        rules = []
        base = {(tuple(r["cart"]), r["suggest"]): r for m in self.members for r in m.to_rules(per_item)}
        for item in vocab:
            for rank, suggest in enumerate(self.recommend([item], per_item)):
                known = base.get(((item,), suggest), {})
                rules.append({
                    "cart": [item],
                    "suggest": suggest,
                    "confidence": known.get("confidence", 0.0),
                    "support": known.get("support", 0),
                    "score": round(1 - rank / per_item, 4),
                })
        return rules
