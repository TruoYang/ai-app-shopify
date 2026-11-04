"""Deep Embedded Clustering (DEC) recommender.

Xie, Girshick, Farhadi. "Unsupervised Deep Embedding for Clustering Analysis", ICML 2016.

1. Item features: positive PMI of item co-occurrence in orders, reduced with truncated SVD.
2. A stacked autoencoder is pretrained on those features (reconstruction loss).
3. DEC fine-tunes the encoder and the cluster centres together: soft assignments q (Student's t)
   are pushed toward a sharpened target p by minimising KL(P || Q).
4. Recommending: candidates come from the clusters of the cart items; they are ranked by
   embedding similarity to the cart combined with how often they were bought with it.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np
import torch
from scipy import sparse
from sklearn.cluster import KMeans
from sklearn.decomposition import TruncatedSVD
from torch import nn

from recommenders import ItemKNN, Recommender


class AutoEncoder(nn.Module):
    def __init__(self, input_dim: int, hidden=(256, 128), embedding_dim=32):
        super().__init__()
        dims = [input_dim, *hidden, embedding_dim]
        encoder, decoder = [], []
        for a, b in zip(dims[:-1], dims[1:]):
            encoder += [nn.Linear(a, b), nn.ReLU()]
        encoder.pop()  # linear embedding layer, as in the paper
        reversed_dims = dims[::-1]
        for a, b in zip(reversed_dims[:-1], reversed_dims[1:]):
            decoder += [nn.Linear(a, b), nn.ReLU()]
        decoder.pop()
        self.encoder = nn.Sequential(*encoder)
        self.decoder = nn.Sequential(*decoder)

    def forward(self, x):
        z = self.encoder(x)
        return z, self.decoder(z)


def soft_assign(z: torch.Tensor, centres: torch.Tensor, alpha: float = 1.0) -> torch.Tensor:
    distance = torch.cdist(z, centres) ** 2
    q = (1 + distance / alpha) ** (-(alpha + 1) / 2)
    return q / q.sum(dim=1, keepdim=True)


def target_distribution(q: torch.Tensor) -> torch.Tensor:
    weight = q ** 2 / q.sum(dim=0)
    return (weight.T / weight.sum(dim=1)).T


class DEC(Recommender):
    name = "dec"

    def __init__(self, n_clusters=None, embedding_dim=32, svd_dim=128, pretrain_epochs=150,
                 dec_iterations=60, clusters_per_item=2, cooc_weight=0.5, seed=42):
        self.n_clusters = n_clusters
        self.embedding_dim = embedding_dim
        self.svd_dim = svd_dim
        self.pretrain_epochs = pretrain_epochs
        self.dec_iterations = dec_iterations
        self.clusters_per_item = clusters_per_item
        self.cooc_weight = cooc_weight
        self.seed = seed

    def _features(self, cooc: sparse.csr_matrix, counts: np.ndarray, n_orders: int) -> np.ndarray:
        # Positive pointwise mutual information of item pairs.
        cooc = cooc.tocoo()
        pmi = np.log((cooc.data * n_orders) / (counts[cooc.row] * counts[cooc.col]))
        keep = pmi > 0
        ppmi = sparse.csr_matrix((pmi[keep], (cooc.row[keep], cooc.col[keep])), shape=(len(counts), len(counts)))
        dim = min(self.svd_dim, len(counts) - 1)
        reduced = TruncatedSVD(n_components=dim, random_state=self.seed).fit_transform(ppmi)
        reduced /= np.linalg.norm(reduced, axis=1, keepdims=True) + 1e-9
        return reduced.astype(np.float32)

    def _fit(self, orders):
        torch.manual_seed(self.seed)
        np.random.seed(self.seed)

        # Reuse item-kNN for the vocabulary, co-occurrence counts and the co-purchase signal.
        self.knn = ItemKNN(neighbours=100).fit(orders)
        self.vocab, self.index = self.knn.vocab, self.knn.index
        cooc = self.knn.cooc.copy()
        x = torch.from_numpy(self._features(cooc, np.maximum(self.knn.counts, 1), len(orders)))

        model = AutoEncoder(x.shape[1], embedding_dim=self.embedding_dim)
        optimiser = torch.optim.Adam(model.parameters(), lr=1e-3)
        loader = torch.utils.data.DataLoader(x, batch_size=256, shuffle=True)
        for _ in range(self.pretrain_epochs):
            for batch in loader:
                _, reconstruction = model(batch)
                loss = nn.functional.mse_loss(reconstruction, batch)
                optimiser.zero_grad()
                loss.backward()
                optimiser.step()

        n_clusters = self.n_clusters or max(8, int(np.sqrt(len(self.vocab) / 2)))
        with torch.no_grad():
            z = model.encoder(x)
        kmeans = KMeans(n_clusters=n_clusters, n_init=10, random_state=self.seed).fit(z.numpy())
        centres = nn.Parameter(torch.tensor(kmeans.cluster_centers_, dtype=torch.float32))
        optimiser = torch.optim.Adam([*model.encoder.parameters(), centres], lr=1e-4)

        previous = kmeans.labels_
        self.dec_history = []
        for iteration in range(self.dec_iterations):
            with torch.no_grad():
                p = target_distribution(soft_assign(model.encoder(x), centres))
            for batch_index in torch.randperm(len(x)).split(256):
                q = soft_assign(model.encoder(x[batch_index]), centres)
                loss = nn.functional.kl_div(q.log(), p[batch_index], reduction="batchmean")
                optimiser.zero_grad()
                loss.backward()
                optimiser.step()
            with torch.no_grad():
                labels = soft_assign(model.encoder(x), centres).argmax(dim=1).numpy()
            changed = float((labels != previous).mean())
            self.dec_history.append({"iteration": iteration, "kl": float(loss.detach()), "changed": changed})
            previous = labels
            if iteration > 5 and changed < 0.001:
                break

        with torch.no_grad():
            self.embeddings = model.encoder(x).numpy()
            self.assignments = soft_assign(model.encoder(x), centres).numpy()
        self.embeddings /= np.linalg.norm(self.embeddings, axis=1, keepdims=True) + 1e-9
        self.top_clusters = np.argsort(-self.assignments, axis=1)[:, : self.clusters_per_item]
        self.members = defaultdict(list)
        for item, clusters in enumerate(self.top_clusters):
            for cluster in clusters:
                self.members[int(cluster)].append(item)
        self.n_clusters_ = n_clusters

    def _scores(self, cart_idx: set[int]) -> dict[int, float]:
        candidates = {j for i in cart_idx for c in self.top_clusters[i] for j in self.members[int(c)]} - cart_idx
        if not candidates:
            return {}
        candidate_list = np.fromiter(candidates, dtype=np.int64)
        cart_vectors = self.embeddings[list(cart_idx)]
        similarity = (self.embeddings[candidate_list] @ cart_vectors.T).mean(axis=1)

        co_purchase = defaultdict(float)
        for i in cart_idx:
            for j, value in self.knn.neighbours_of.get(i, ()):
                co_purchase[j] += value
        top = max(co_purchase.values(), default=1.0) or 1.0
        return {
            int(j): float((1 - self.cooc_weight) * s + self.cooc_weight * co_purchase.get(int(j), 0.0) / top)
            for j, s in zip(candidate_list, similarity)
        }

    def recommend(self, cart, k=10):
        cart_idx = {self.index[item] for item in cart if item in self.index}
        if not cart_idx:
            return []
        scores = self._scores(cart_idx)
        return [self.vocab[j] for j, _ in sorted(scores.items(), key=lambda kv: -kv[1])[:k]]

    def to_rules(self, per_item=10):
        rules = []
        for i in range(len(self.vocab)):
            scores = self._scores({i})
            for j, score in sorted(scores.items(), key=lambda kv: -kv[1])[:per_item]:
                together = int(self.knn.cooc[i, j])
                rules.append({
                    "cart": [self.vocab[i]],
                    "suggest": self.vocab[j],
                    "confidence": round(together / max(self.knn.counts[i], 1), 4),
                    "support": together,
                    "score": round(score, 4),
                })
        return rules
