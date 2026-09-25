"""
XGBoost forecaster — best short-horizon accuracy when promo/price/weather
features are available, at the cost of needing more feature engineering
than Prophet. Needs `pip install xgboost`.

Like forecast_prophet.py, this is real, correct XGBoost usage but is not
executed in this scaffold — there's no live database or trained model file
in this environment.
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


def build_features(history: pd.DataFrame) -> pd.DataFrame:
    """history needs columns: date, units_sold, promo_flag, temperature_c,
    is_holiday, local_event_flag — i.e. one row per day, straight from
    SalesRecord for a (store_id, category) pair, sorted by date ascending."""
    df = history.copy().sort_values("date").reset_index(drop=True)
    df["day_of_week"] = df["date"].dt.dayofweek
    df["day_of_month"] = df["date"].dt.day
    df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
    df["lag_1"] = df["units_sold"].shift(1)
    df["lag_7"] = df["units_sold"].shift(7)
    df["rolling_mean_7"] = df["units_sold"].rolling(window=7, min_periods=1).mean()
    return df


def train(history: pd.DataFrame) -> xgb.XGBRegressor:
    df = build_features(history).dropna(subset=["lag_1", "lag_7"])
    model = xgb.XGBRegressor(
        n_estimators=300,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.85,
        colsample_bytree=0.85,
        objective="reg:squarederror",
        random_state=42,
    )
    model.fit(df[FEATURE_COLUMNS], df["units_sold"])
    return model


def forecast_next(model: xgb.XGBRegressor, recent_history: pd.DataFrame, horizon_days: int = 7) -> list[float]:
    """Iterative multi-step forecast: predict day t+1, append it to the
    history, recompute lag/rolling features, predict t+2, etc. XGBoost has
    no native notion of "the future" the way Prophet does, so this is the
    standard way to get a multi-day horizon out of a tabular model."""
    working = build_features(recent_history).copy()
    preds: list[float] = []
    for _ in range(horizon_days):
        last_row = working.iloc[[-1]][FEATURE_COLUMNS].copy()
        # naive carry-forward for exogenous features the caller hasn't
        # supplied a real future value for yet (promo calendar, weather forecast)
        next_pred = float(model.predict(last_row)[0])
        preds.append(next_pred)

        new_row = working.iloc[-1].copy()
        new_row["units_sold"] = next_pred
        new_row["lag_1"] = next_pred
        new_row["lag_7"] = working["units_sold"].iloc[-6] if len(working) >= 6 else next_pred
        new_row["rolling_mean_7"] = np.mean(list(working["units_sold"].tail(6)) + [next_pred])
        working = pd.concat([working, pd.DataFrame([new_row])], ignore_index=True)

    return preds
