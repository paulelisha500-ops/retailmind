"""
Demand forecasting. Every method trains live against the store's own sales history, and a repeat request for
unchanged data is served from a cache (safe, because training is seeded and would reproduce the same result).

The response carries the last fortnight of actual sales followed by the forecast, so a chart can draw both from one
list, plus an accuracy figure and a reorder suggestion. The forecasting libraries are imported when a method is first
used, so the rest of the API runs without them installed (a method whose library is missing answers 501).
"""
import math
import threading
import time
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SalesRecord, User
from app.schemas import ForecastPoint, ForecastResponse
from app.security import require_employee

router = APIRouter(prefix="/forecast", tags=["forecast"])

VALID_MODELS = {"prophet", "xgboost", "lstm", "tft"}
HISTORY_DAYS = 90
CONTEXT_DAYS = 14  # recent actuals shown ahead of the forecast

# Training is seeded (torch seed 42, XGBoost random_state 42), so the same history always yields the same forecast;
# the fingerprint below changes whenever any training input does.
_CACHE_TTL_SECONDS = 30 * 60
_CACHE_MAX_ENTRIES = 128
_forecast_cache: dict[tuple, tuple[float, ForecastResponse]] = {}
_forecast_cache_lock = threading.Lock()

XGB_COLS = ["date", "units_sold", "promo_flag", "temperature_c", "is_holiday", "local_event_flag"]


def _history_fingerprint(history: pd.DataFrame) -> int:
    cols = ["ds", "units_sold", "promo_flag", "temperature_c", "is_holiday", "local_event_flag"]
    return int(pd.util.hash_pandas_object(history[cols], index=False).sum())


def _load_history(db: Session, store_id: str, category: str, days_back: int = HISTORY_DAYS) -> pd.DataFrame:
    cutoff = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=days_back)
    rows = (
        db.query(SalesRecord)
        .filter(
            SalesRecord.store_id == store_id,
            SalesRecord.category == category,
            SalesRecord.date >= cutoff,
        )
        .order_by(SalesRecord.date.asc())
        .all()
    )
    return pd.DataFrame(
        [
            {
                "ds": r.date, "date": r.date, "y": r.units_sold, "units_sold": r.units_sold,
                "promo_flag": int(r.promo_flag), "temperature_c": r.temperature_c if r.temperature_c is not None else 0.0,
                "is_holiday": int(r.is_holiday), "local_event_flag": int(r.local_event_flag),
            }
            for r in rows
        ]
    )


def _run_model(model: str, history: pd.DataFrame, horizon_days: int) -> pd.DataFrame:
    """Runs one method and returns a DataFrame with ds/yhat[/yhat_lower/yhat_upper].

    Raises NotImplementedError when the method can't run (too little history, or its library isn't installed);
    the caller turns that into a 501."""
    try:
        if model == "prophet":
            from app.ml import forecast_prophet
            return forecast_prophet.train_and_forecast(history[["ds", "y", "promo_flag"]], horizon_days)
        if model == "xgboost":
            from app.ml import forecast_xgboost
            xgb_model = forecast_xgboost.train(history[XGB_COLS])
            predictions = forecast_xgboost.forecast_next(xgb_model, history[XGB_COLS], horizon_days)
            dates = pd.date_range(pd.to_datetime(history["date"]).iloc[-1] + pd.Timedelta(days=1), periods=horizon_days)
            return pd.DataFrame({"ds": dates, "yhat": predictions})
        from app.ml import forecast_lstm_tft
        if model == "lstm":
            return forecast_lstm_tft.train_and_forecast_lstm(history, horizon_days)
        return forecast_lstm_tft.train_and_forecast_tft(history, horizon_days)
    except ImportError as exc:
        raise NotImplementedError(f"The {model} forecasting method needs a library that isn't installed here ({exc.name}).") from exc
    except ValueError as exc:  # too little history for this method
        raise NotImplementedError(str(exc)) from exc


def _compute_live_mape(model: str, history: pd.DataFrame, test_days: int = 7) -> float | None:
    """Rolling accuracy: train on everything but the last `test_days`, predict those days, compare to what actually
    sold. A real backtest against live sales_records, so it returns None (shown as "not enough data yet") rather than a
    made-up number when there isn't enough history to hold out a fair test window."""
    if len(history) < test_days + 20:
        return None
    train_df = history.iloc[:-test_days].reset_index(drop=True)
    test_df = history.iloc[-test_days:].reset_index(drop=True)
    actual = test_df["units_sold"].to_numpy(dtype=float)
    try:
        result = _run_model(model, train_df, test_days)
    except NotImplementedError:
        return None
    predicted = result["yhat"].to_numpy(dtype=float)[: len(actual)]
    if len(predicted) < len(actual):
        return None
    mask = actual != 0
    if not mask.any():
        return None
    return float((np.abs((actual[mask] - predicted[mask]) / actual[mask])).mean() * 100)


def _month_day(day) -> str:
    return f"{day:%b} {day.day}"


def _iso(day) -> str:
    return pd.Timestamp(day).strftime("%Y-%m-%dT%H:%M:%SZ")


def _none_if_nan(value):
    return None if value is None or (isinstance(value, float) and math.isnan(value)) else round(float(value), 1)


@router.get("/{category}", response_model=ForecastResponse)
def get_forecast(
    category: str,
    store_id: str,
    model: str = "tft",
    horizon_days: int = 7,
    db: Session = Depends(get_db),
    _: User = Depends(require_employee),
):
    """The four methods behind the Forecast screen's switcher: seasonal (Prophet), boosted trees (XGBoost), an LSTM,
    and an attention network (a compact Transformer encoder — see app/ml/forecast_lstm_tft.py for what that means
    here). All train live. Prophet and XGBoost report a genuine held-out backtest; the two networks report their
    fit on the data they trained on and say so (mape_kind)."""
    if model not in VALID_MODELS:
        raise HTTPException(status_code=422, detail=f"model must be one of {sorted(VALID_MODELS)}")
    if not 1 <= horizon_days <= 30:
        raise HTTPException(status_code=422, detail="horizon_days must be between 1 and 30")

    history = _load_history(db, store_id, category)
    if history.empty:
        raise HTTPException(status_code=404, detail="No sales history for this store/category yet")

    cache_key = (store_id, category, model, horizon_days, _history_fingerprint(history))
    with _forecast_cache_lock:
        hit = _forecast_cache.get(cache_key)
    if hit and time.time() - hit[0] < _CACHE_TTL_SECONDS:
        return hit[1]

    try:
        result = _run_model(model, history, horizon_days)
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    if model in ("lstm", "tft"):
        mape, mape_kind = result.attrs.get("mape"), "training_fit"
    else:
        mape, mape_kind = _compute_live_mape(model, history), "backtest"
    if mape is not None and not math.isfinite(mape):
        mape = None

    tail = history.tail(CONTEXT_DAYS).reset_index(drop=True)
    points = [
        ForecastPoint(
            label=_month_day(row.date), date=_iso(row.date), kind="actual", actual=float(row.units_sold),
            predicted=float(row.units_sold) if i == len(tail) - 1 else None,  # the forecast line starts where the actuals end
        )
        for i, row in enumerate(tail.itertuples())
    ]
    points += [
        ForecastPoint(
            label=_month_day(row.ds), date=_iso(row.ds), kind="forecast", predicted=round(float(row.yhat), 1),
            band_low=_none_if_nan(getattr(row, "yhat_lower", None)), band_high=_none_if_nan(getattr(row, "yhat_upper", None)),
        )
        for row in result.itertuples()
    ]

    expected = float(result["yhat"].sum())
    recent_avg = float(history["units_sold"].tail(7).mean())
    response = ForecastResponse(
        category=category,
        model=model,
        mape=None if mape is None else round(mape, 1),
        mape_kind=None if mape is None else mape_kind,
        points=points,
        recommendation=(
            f"Expected demand is {round(expected):,} units over the next {horizon_days} days "
            f"({round(expected / horizon_days)}/day), against {round(recent_avg)}/day over the past week."
        ),
        recommended_po_quantity=math.ceil(expected * 1.1),  # +10% safety stock
        confidence=None if mape is None else round(min(1.0, max(0.0, 1 - mape / 100)), 2),
    )
    with _forecast_cache_lock:
        if len(_forecast_cache) >= _CACHE_MAX_ENTRIES:
            _forecast_cache.pop(min(_forecast_cache, key=lambda k: _forecast_cache[k][0]))
        _forecast_cache[cache_key] = (time.time(), response)
    return response
