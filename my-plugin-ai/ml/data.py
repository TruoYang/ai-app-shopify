"""Order datasets for training and offline evaluation.

An order is a basket of distinct item keys with an optional timestamp. Two sources:
- the JSON exported by the app (app/training-data.server.js, buildTrainingDataset);
- a raw CSV with one line per order line (e.g. data/data.csv, the UCI Online Retail set),
  used for the research experiments.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pandas as pd


@dataclass(frozen=True)
class Order:
    id: str
    date: datetime | None
    items: tuple[str, ...]


def load_orders_json(path: str | Path) -> list[Order]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    orders = []
    for row in data["orders"]:
        date = datetime.fromisoformat(row["date"].replace("Z", "+00:00")) if row.get("date") else None
        items = tuple(dict.fromkeys(str(item) for item in row["items"]))
        if items:
            orders.append(Order(str(row["id"]), date, items))
    return orders


def load_orders_csv(
    path: str | Path,
    order_col: str = "InvoiceNo",
    item_col: str = "StockCode",
    date_col: str | None = "InvoiceDate",
    quantity_col: str | None = "Quantity",
    date_format: str | None = "%m/%d/%Y %H:%M",
) -> list[Order]:
    """Groups order lines into baskets; zero or negative quantities (returns) are dropped."""
    columns = [c for c in (order_col, item_col, date_col, quantity_col) if c]
    frame = pd.read_csv(path, usecols=columns, dtype={order_col: str, item_col: str}, encoding_errors="replace")
    frame = frame.dropna(subset=[order_col, item_col])
    if quantity_col:
        frame = frame[pd.to_numeric(frame[quantity_col], errors="coerce") > 0]
    if date_col:
        frame["_date"] = pd.to_datetime(frame[date_col], format=date_format, errors="coerce")
    else:
        frame["_date"] = pd.NaT

    orders = []
    for order_id, group in frame.groupby(order_col, sort=False):
        items = tuple(dict.fromkeys(group[item_col].str.strip()))
        date = group["_date"].min()
        orders.append(Order(str(order_id), None if pd.isna(date) else date.to_pydatetime(), items))
    return orders


def time_split(orders: list[Order], test_ratio: float = 0.2) -> tuple[list[Order], list[Order]]:
    """Oldest (1 - test_ratio) of the orders for training, newest for testing.

    Orders without a date keep their original order and go to the training part."""
    dated = sorted((o for o in orders if o.date), key=lambda o: o.date)
    undated = [o for o in orders if not o.date]
    cut = int(len(dated) * (1 - test_ratio))
    return undated + dated[:cut], dated[cut:]


def summary(orders: list[Order]) -> dict:
    sizes = [len(o.items) for o in orders]
    dates = [o.date for o in orders if o.date]
    return {
        "orders": len(orders),
        "items": len({item for o in orders for item in o.items}),
        "multi_item_orders": sum(size >= 2 for size in sizes),
        "mean_basket": round(sum(sizes) / max(len(sizes), 1), 2),
        "from": min(dates).isoformat() if dates else None,
        "to": max(dates).isoformat() if dates else None,
    }
