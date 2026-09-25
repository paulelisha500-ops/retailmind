"""
Prophet forecaster — best for categories with strong weekly/holiday
seasonality (Produce, Bakery). Needs the `prophet` package installed
(`pip install prophet`, which pulls in cmdstanpy) and is CPU-only, so it's
cheap to run on a schedule rather than needing a GPU worker.

This module is written against the real Prophet API and is meant to be run
once real `sales_records` history exists — it is NOT executed as part of
this scaffold (no DB/data available in this environment).
"""
from __future__ import annotations

import pandas as pd
from prophet import Prophet


def train_and_forecast(history: pd.DataFrame, horizon_days: int = 7, holidays: pd.DataFrame | None = None) -> pd.DataFrame:
    """
    history: DataFrame with columns ['ds', 'y'] — date and units_sold,
        pulled from SalesRecord for one (store_id, category) pair.
    holidays: optional Prophet-style holidays DataFrame (columns
        ['holiday', 'ds']) built from is_holiday / local_event_flag rows.
    Returns a DataFrame with ['ds', 'yhat', 'yhat_lower', 'yhat_upper']
    for the next `horizon_days`, which the /forecast router maps onto the
    ForecastPoint schema the frontend chart consumes.
    """
    model = Prophet(
        weekly_seasonality=True,
        yearly_seasonality=False,   # not enough history in year one; revisit once 12mo+ of data exists
        daily_seasonality=False,
        interval_width=0.90,        # 90% confidence band, shown as the shaded area on the chart
        holidays=holidays,
    )
    # Promotions move demand as much as holidays do for grocery — register
    # them as an extra regressor if the caller attached a 'promo_flag' column.
    if "promo_flag" in history.columns:
        model.add_regressor("promo_flag")

    model.fit(history)

    future = model.make_future_dataframe(periods=horizon_days)
    if "promo_flag" in history.columns:
        # Naive carry-forward of the last known promo calendar; in
        # production this should be joined from a real promo-planning table.
        future["promo_flag"] = history["promo_flag"].iloc[-1]

    forecast = model.predict(future)
    return forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]].tail(horizon_days)


def compute_mape(actual: pd.Series, predicted: pd.Series) -> float:
    """Rolling accuracy metric shown in the Forecast Studio MLOps strip."""
    mask = actual != 0
    return float((abs((actual[mask] - predicted[mask]) / actual[mask])).mean() * 100)
