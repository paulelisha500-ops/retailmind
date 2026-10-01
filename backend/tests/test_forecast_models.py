"""The real forecasting methods against the seeded sales history. Each skips itself when its library isn't installed;
the CI workflow that installs requirements.txt in full sets REQUIRE_FORECAST_LIBS so a missing library fails instead."""
import importlib
import os
import time

import pandas as pd
import pytest

from app.routers import forecast


def need(library: str):
    if os.environ.get("REQUIRE_FORECAST_LIBS"):
        return importlib.import_module(library)
    return pytest.importorskip(library)


@pytest.fixture()
def history(db, hq):
    return forecast._load_history(db, hq.id, "Dairy & Chilled")


def plausible(frame: pd.DataFrame, history: pd.DataFrame, horizon: int):
    base = history["units_sold"].tail(28).mean()
    assert len(frame) == horizon
    last = pd.Timestamp(history["ds"].iloc[-1])
    for i, row in enumerate(frame.itertuples()):
        assert base * 0.5 < row.yhat < base * 1.6
        assert pd.Timestamp(row.ds).normalize() == last + pd.Timedelta(days=i + 1)
        if hasattr(row, "yhat_lower") and not pd.isna(row.yhat_lower):
            assert row.yhat_lower <= row.yhat <= row.yhat_upper


@pytest.mark.parametrize("model, ceiling", [("prophet", 20), ("xgboost", 25)])
def test_a_plausible_week_ahead_and_a_real_backtest(model, ceiling, history):
    need("prophet" if model == "prophet" else "xgboost")
    plausible(forecast._run_model(model, history, 7), history, 7)
    mape = forecast._compute_live_mape(model, history)
    assert 0 < mape < ceiling


@pytest.mark.parametrize("model", ["lstm", "tft"])
def test_the_networks_train_fit_the_history_and_forecast_the_horizon(model, history):
    need("torch")
    started = time.time()
    frame = forecast._run_model(model, history, 7)
    plausible(frame, history, 7)
    assert 0 < frame.attrs["mape"] < 25
    assert time.time() - started < 60


def test_gradient_boosting_captures_the_weekend_uplift_that_is_in_the_data(history):
    need("xgboost")
    days = pd.to_datetime(history["ds"]).dt.dayofweek
    assert history.loc[days >= 5, "units_sold"].mean() > history.loc[days < 5, "units_sold"].mean()
    frame = forecast._run_model("xgboost", history, 14)
    weekend = pd.to_datetime(frame["ds"]).dt.dayofweek >= 5
    assert frame.loc[weekend, "yhat"].mean() > frame.loc[~weekend, "yhat"].mean()


@pytest.mark.parametrize("model", ["xgboost", "lstm"])
def test_is_deterministic_the_same_history_always_gives_the_same_forecast(model, history):
    need("xgboost" if model == "xgboost" else "torch")
    first = forecast._run_model(model, history, 7)["yhat"].round(6).tolist()
    assert forecast._run_model(model, history, 7)["yhat"].round(6).tolist() == first


def test_refuses_to_fabricate_a_forecast_from_too_little_history(history):
    need("torch")
    with pytest.raises(NotImplementedError, match="at least"):
        forecast._run_model("lstm", history.tail(20), 7)
    with pytest.raises(NotImplementedError, match="at least"):
        forecast._run_model("tft", history.tail(30), 7)
    need("xgboost")
    assert forecast._compute_live_mape("xgboost", history.tail(20)) is None
