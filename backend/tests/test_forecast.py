"""The forecast route, exercised with a stand-in forecaster so it runs without Prophet, XGBoost or PyTorch. The real
methods are covered in test_forecast_models.py, which skips each one whose library isn't installed."""
import math
import re
import sys
import types
from datetime import datetime, timedelta

import pandas as pd
import pytest

import app.ml as ml_package
from app.models import SalesRecord, Store
from app.routers import forecast


@pytest.fixture()
def fake_models(monkeypatch):
    """Replaces the method runner with a seasonal-naive one (tomorrow looks like the same weekday last week), and
    counts how often it is asked to train."""
    calls = {"count": 0}

    def run(model, history, horizon_days):
        calls["count"] += 1
        if len(history) < 24 and model in ("lstm", "tft"):
            raise NotImplementedError(f"{model.upper()} needs at least 24 days of history, got {len(history)}")
        units = history["units_sold"].astype(float).tolist()
        last = pd.Timestamp(history["date"].iloc[-1])
        rows = []
        for i in range(horizon_days):
            value = units[-7 + (i % 7)]
            rows.append({"ds": last + pd.Timedelta(days=i + 1), "yhat": value, "yhat_lower": value * 0.9, "yhat_upper": value * 1.1})
        frame = pd.DataFrame(rows)
        frame.attrs["mape"] = 8.4
        return frame

    monkeypatch.setattr(forecast, "_run_model", run)
    forecast._forecast_cache.clear()
    yield calls
    forecast._forecast_cache.clear()


def url(hq, category="Dairy & Chilled", **params):
    query = "&".join(f"{k}={v}" for k, v in {"store_id": hq.id, **params}.items())
    return f"/forecast/{category.replace(' ', '%20').replace('&', '%26')}?{query}"


class TestForecastRoute:
    def test_returns_actuals_then_a_forecast_with_the_recommendation_and_a_backtest(self, api, hq, fake_models):
        res = api.get(url(hq, model="prophet", horizon_days=7), "manager")
        assert res.status_code == 200
        body = res.json()
        actuals = [p for p in body["points"] if p["kind"] == "actual"]
        future = [p for p in body["points"] if p["kind"] == "forecast"]
        assert (len(actuals), len(future)) == (14, 7)
        assert actuals[-1]["predicted"] == actuals[-1]["actual"]  # the lines join where the actuals end
        assert all(p["predicted"] is None for p in actuals[:-1])
        assert body["points"][-1]["actual"] is None and body["points"][-1]["band_low"] < body["points"][-1]["predicted"] < body["points"][-1]["band_high"]
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT00:00:00Z", body["points"][0]["date"])
        assert body["mape"] > 0 and body["mape_kind"] == "backtest"
        assert body["confidence"] == pytest.approx(1 - body["mape"] / 100, abs=0.011)
        expected = sum(p["predicted"] for p in future)
        assert abs(body["recommended_po_quantity"] - math.ceil(expected * 1.1)) <= 1  # ten percent over; the points are rounded
        assert re.match(r"^Expected demand is [\d,]+ units over the next 7 days", body["recommendation"])

    def test_the_two_networks_report_their_training_fit_and_say_so(self, api, hq, fake_models):
        body = api.get(url(hq, model="lstm"), "manager").json()
        assert body["mape"] == 8.4 and body["mape_kind"] == "training_fit"
        assert api.get(url(hq, model="tft"), "manager").json()["mape_kind"] == "training_fit"

    def test_serves_a_repeat_request_from_cache_and_retrains_when_sales_change(self, api, db, hq, fake_models):
        first = api.get(url(hq, "Produce", model="xgboost", horizon_days=5), "manager").json()
        trained = fake_models["count"]
        assert api.get(url(hq, "Produce", model="xgboost", horizon_days=5), "manager").json() == first
        assert fake_models["count"] == trained  # served from cache
        assert api.get(url(hq, "Produce", model="xgboost", horizon_days=6), "manager").status_code == 200
        assert fake_models["count"] > trained  # a different horizon is a different forecast

        latest = db.query(SalesRecord).filter(SalesRecord.store_id == hq.id, SalesRecord.category == "Produce").order_by(SalesRecord.date.desc()).first()
        latest.units_sold += 400
        db.commit()
        changed = api.get(url(hq, "Produce", model="xgboost", horizon_days=5), "manager").json()
        assert [p for p in changed["points"] if p["kind"] == "actual"][-1]["actual"] == latest.units_sold

    def test_validates_the_model_the_horizon_and_the_data(self, api, hq, fake_models):
        bad = api.get(url(hq, "Produce", model="arima"), "manager")
        assert (bad.status_code, bad.json()) == (422, {"detail": "model must be one of ['lstm', 'prophet', 'tft', 'xgboost']"})
        assert api.get(url(hq, "Produce", horizon_days=0), "manager").status_code == 422
        assert api.get(url(hq, "Produce", horizon_days=31), "manager").status_code == 422
        missing = api.get(url(hq, "Nonexistent"), "manager")
        assert (missing.status_code, missing.json()) == (404, {"detail": "No sales history for this store/category yet"})
        assert api.get("/forecast/Produce", "manager").status_code == 422
        assert api.get(url(hq, "Produce"), "customer").status_code == 403
        assert api.get(url(hq, "Produce")).status_code == 401

    def test_answers_501_for_a_method_that_cannot_run_and_keeps_serving_the_others(self, api, db, fake_models):
        riverside = db.query(Store).filter(Store.name == "Riverside Mall").one()
        keep = [r.id for r in db.query(SalesRecord).filter(SalesRecord.store_id == riverside.id, SalesRecord.category == "Bakery").order_by(SalesRecord.date.desc()).limit(15)]
        db.query(SalesRecord).filter(SalesRecord.store_id == riverside.id, SalesRecord.category == "Bakery", SalesRecord.id.notin_(keep)).delete(synchronize_session=False)
        db.commit()
        res = api.get(url(riverside, "Bakery", model="lstm"), "manager")
        assert res.status_code == 501 and "LSTM needs at least 24 days" in res.json()["detail"]
        assert api.get(url(riverside, "Bakery", model="prophet"), "manager").status_code == 200


class TestMethodRunner:
    """_run_model's own contract: a missing library or too little history is 'not available', never a crash."""

    @pytest.fixture()
    def history(self, db, hq):
        return forecast._load_history(db, hq.id, "Dairy & Chilled")

    def test_loads_a_daily_history_oldest_first(self, history):
        assert len(history) >= 60
        assert history["ds"].is_monotonic_increasing
        assert {"y", "units_sold", "promo_flag", "temperature_c", "is_holiday", "local_event_flag"} <= set(history.columns)
        assert history["ds"].iloc[-1] <= pd.Timestamp(datetime.utcnow())

    def test_a_library_that_is_not_installed_becomes_not_available(self, history, monkeypatch):
        monkeypatch.delitem(sys.modules, "app.ml.forecast_xgboost", raising=False)
        monkeypatch.delattr(ml_package, "forecast_xgboost", raising=False)
        monkeypatch.setitem(sys.modules, "xgboost", None)  # makes `import xgboost` raise ImportError
        with pytest.raises(NotImplementedError, match="xgboost"):
            forecast._run_model("xgboost", history, 7)

    def test_too_little_history_becomes_not_available(self, history, monkeypatch):
        def refuse(_history):
            raise ValueError("need at least 8 days of history to train, got 3")

        monkeypatch.setattr(ml_package, "forecast_xgboost", types.SimpleNamespace(train=refuse), raising=False)
        with pytest.raises(NotImplementedError, match="need at least 8 days"):
            forecast._run_model("xgboost", history.head(3), 7)

    def test_the_backtest_needs_enough_history_to_hold_out_a_fair_window(self, history, monkeypatch):
        monkeypatch.setattr(forecast, "_run_model", lambda *a: (_ for _ in ()).throw(NotImplementedError("no")))
        assert forecast._compute_live_mape("prophet", history) is None  # the method can't run
        assert forecast._compute_live_mape("prophet", history.head(20)) is None  # too little to hold out a week

    def test_the_backtest_is_the_mean_absolute_percentage_error_on_the_held_out_week(self, history, monkeypatch):
        held_out = history["units_sold"].tail(7).to_numpy(dtype=float)

        def always_ten_percent_high(model, train, horizon):
            return pd.DataFrame({"ds": pd.date_range("2030-01-01", periods=horizon), "yhat": held_out * 1.1})

        monkeypatch.setattr(forecast, "_run_model", always_ten_percent_high)
        assert forecast._compute_live_mape("prophet", history) == pytest.approx(10.0)

    def test_the_fingerprint_changes_when_any_training_input_does(self, history):
        assert forecast._history_fingerprint(history) == forecast._history_fingerprint(history.copy())
        edited = history.copy()
        edited.loc[10, "units_sold"] += 1
        assert forecast._history_fingerprint(edited) != forecast._history_fingerprint(history)


def test_the_history_window_ends_today(db, hq):
    latest = forecast._load_history(db, hq.id, "Produce")["ds"].iloc[-1]
    assert datetime.utcnow() - timedelta(days=2) < latest.to_pydatetime() <= datetime.utcnow()
