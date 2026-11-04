# Phase 3 progress (data)

Resume prompt: "tiếp tục Phase 3, đọc docs/PHASE3_PROGRESS.md". Work one step at a time; tick a step only after it is verified.

## Steps

- [x] 1. Schema: `CsvImport` (import log + column mapping), `CsvProduct` (CSV product code/name, order count, mapped shop product key, 1-1), `ShopSettings` (training date window, later schedule).
- [x] 2. Import page `/app/data`: upload CSV, auto-detect delimiter, preview first rows, choose a role per column (order ID, product code/SKU, name, quantity, date, price, customer, ignore) with header-based guesses; replace or append.
- [x] 3. Server import: stream-parse the whole file with the chosen mapping, group lines into orders, skip cancelled/zero-quantity lines, save `OrderHistory` (source `csv_import`) and `CsvProduct` counts.
- [x] 4. Matching page `/app/data/match` (file app.data_.match.jsx): CSV products listed by name (most ordered first), "Choose matching shop product" per row, one shop product per CSV product, search, filter matched/unmatched.
- [x] 5. Training uses the mapping (CSV code → shop product key; unmapped codes dropped) and the training date window from `ShopSettings`.
- [x] 6. Remove Phase 2 test data (`test_*` orders, test model rules) and the old `api.import-csv.jsx` that read `data/data.csv`.

## Notes

- Place: a "Data" page reached from the home page / nav, separate from the daily Recommendations page.
- All 6 steps built and tested at module level (UCI data.csv: 541,909 rows -> 20,728 orders in ~4 s). Pages /app/data and /app/data/match not yet clicked through in the admin (dev server was down).
