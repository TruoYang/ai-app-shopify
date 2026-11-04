# Phase 4 progress (algorithms and evaluation)

Resume prompt: "tiếp tục Phase 4, đọc docs/PHASE4_PROGRESS.md". Work one step at a time; tick a step only after it is verified.

## Design

- Node keeps all database logic. It exports the training orders (product keys + dates, after the
  training window and CSV matching) to JSON and runs `ml/train.py`, which writes rules JSON back.
- Python (`ml/`, own virtualenv `ml/.venv`) holds the algorithms and the offline evaluation.
- Every algorithm outputs the same rule format (`cart` → `suggest`, `confidence`, `support`, `score`)
  so the storefront recommender does not change.

## Steps

- [x] 1. `ml/` package + virtualenv + requirements (numpy, pandas, scikit-learn, mlxtend, torch CPU, matplotlib).
- [x] 2. Dataset export from Node (`app/training-data.server.js`) and loader in Python.
- [x] 3. Algorithms: Apriori baseline (same as `app/ai-logic.js`), FP-Growth, item-kNN (cosine), popularity baseline.
- [x] 4. DEC: autoencoder item embeddings + deep embedded clustering; recommend from the cart item's cluster, ranked by co-occurrence.
- [x] 5. Offline evaluation: time-based 80/20 split, leave-one-out over test orders (sample 1000+), HitRate/Precision/Recall/NDCG@K, MRR, coverage, train time; report JSON + CSV + charts in `docs/eval/`.
- [x] 6. Train route runs the chosen algorithm through Python (fallback to the JS Apriori when Python is missing); merchant chooses the strategy.
- [x] 7. Ranking priority for merchants: revenue / quantity sold / interaction weights.
- [x] 8. Scheduled retraining: none / weekly / monthly (no daily), stored in `ShopSettings`.

## Notes

- Python: `C:\Users\giang\AppData\Local\Programs\Python\Python312\python.exe` (3.12.10).
- Results: `docs/eval/results.json|csv`, charts `docs/eval/*.png`, write-up `docs/eval/README.md`. Re-run: `ml/.venv/Scripts/python.exe ml/evaluate.py --csv data/data.csv --cases 1000 --repeats 3`.
- Training logic moved to `app/training.server.js` (`runTraining`), used by `api.train.jsx` and `app/scheduler.server.js` (hourly check, started in `entry.server.jsx`, `DISABLE_SCHEDULER=1` turns it off).
- Hybrid (RRF of FP-Growth + kNN + DEC, weights 1/0.5/0.5, k=60 fixed a priori) added after the first run; no tuning on the test split.
- Not yet clicked through in the admin: Data page Training card (algorithm / priority / schedule).
