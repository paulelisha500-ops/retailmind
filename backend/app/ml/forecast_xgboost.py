"""
Gradient-boosted trees (XGBoost) forecaster — sharp short-horizon forecasts when promotion and weather features are
available, at the cost of more feature engineering than Prophet. Needs the `xgboost` package.

The model learns "what sold today" from the calendar (day of week, day of month, weekend), the day's promotion,
holiday, local-event and temperature flags, and what sold before it: yesterday, a week ago, and the average of the
previous seven days. Every one of those lags looks strictly backwards, so a row never contains its own target.

The multi-day forecast is iterative: predict tomorrow, add it to the series, move the calendar on one day, recompute
the lags, predict the day after. Promotion, holiday and event flags default to "none" for days that haven't happened
(a real deployment would join a promotion calendar here) and temperature carries forward as the recent average.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import xgboost as xgb

FEATURE_COLUMNS = [
    "day_of_week", "day_of_month", "is_weekend", "is_holiday",
    "local_event_flag", "promo_flag", "temperature_c",
    "lag_1", "lag_7", "rolling_mean_7",
]

MIN_HISTORY = 8  # a week of lags plus at least one row to learn from


def _feature_row(date: pd.Timestamp, past: list[float], promo: float, temperature: float, holiday: float, event: float) -> list[float]:
    """Features for `date`, given the unit sales of every day before it (oldest first)."""
    lag_7 = past[-7] if len(past) >= 7 else past[0]
    return [
        float(date.dayofweek), float(date.day), float(date.dayofweek >= 5), float(holiday),
        float(event), float(promo), float(temperature),
        past[-1], lag_7, float(np.mean(past[-7:])),
    ]


def build_training_set(history: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """history: one row per day, oldest first, with date, units_sold, promo_flag, temperature_c, is_holiday and
    local_event_flag — straight from SalesRecord for one (store, category) pair."""
    df = history.sort_values("date").reset_index(drop=True)
    units = df["units_sold"].astype(float).tolist()
    rows = []
    for i in range(7, len(df)):
        row = df.iloc[i]
        rows.append(_feature_row(pd.Timestamp(row["date"]), units[:i], row["promo_flag"], row["temperature_c"], row["is_holiday"], row["local_event_flag"]))
    return pd.DataFrame(rows, columns=FEATURE_COLUMNS), df["units_sold"].iloc[7:].reset_index(drop=True)


def train(history: pd.DataFrame) -> xgb.XGBRegressor:
    if len(history) < MIN_HISTORY:
        raise ValueError(f"need at least {MIN_HISTORY} days of history to train, got {len(history)}")
    features, target = build_training_set(history)
    model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="reg:squarederror",
        random_state=42,
    )
    model.fit(features, target)
    return model


def forecast_next(model: xgb.XGBRegressor, recent_history: pd.DataFrame, horizon_days: int = 7) -> list[float]:
    """Predicts the `horizon_days` days after the last row of `recent_history`."""
    df = recent_history.sort_values("date").reset_index(drop=True)
    series = df["units_sold"].astype(float).tolist()
    temperature = float(df["temperature_c"].tail(7).mean())
    day = pd.Timestamp(df["date"].iloc[-1])
    predictions: list[float] = []
    for _ in range(horizon_days):
        day = day + pd.Timedelta(days=1)
        features = pd.DataFrame([_feature_row(day, series, promo=0, temperature=temperature, holiday=0, event=0)], columns=FEATURE_COLUMNS)
        predicted = max(0.0, float(model.predict(features)[0]))
        predictions.append(predicted)
        series.append(predicted)
    return predictions
