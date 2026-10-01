"""
Prophet forecaster — best for categories with strong weekly and holiday seasonality (Produce, Bakery). Needs the
`prophet` package (`pip install prophet`, which brings cmdstanpy) and is CPU-only, so it is cheap to train on every
request; the route caches the result until the sales history changes.
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
        # The last known promotion flag carries forward; a promotion calendar would be joined in here.
        future["promo_flag"] = history["promo_flag"].iloc[-1]

    forecast = model.predict(future)
    return forecast[["ds", "yhat", "yhat_lower", "yhat_upper"]].tail(horizon_days)
