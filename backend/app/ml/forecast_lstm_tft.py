"""
LSTM and a compact Transformer-based multi-horizon forecaster, trained live
per request against `sales_records` — the same "train on the request"
pattern forecast_prophet.py / forecast_xgboost.py already use, just with
PyTorch (CPU-only build) instead of prophet/xgboost.

Honesty note on the "TFT" model: `train_and_forecast_tft` below is a real,
trained, attention-based multi-horizon forecaster (a small Transformer
encoder over the lookback window with a direct multi-step head) — but it is
NOT the full published Temporal Fusion Transformer (no variable-selection
networks, gated residual networks, or quantile loss). That needs
pytorch-forecasting and materially more history per category than the ~90
days this demo seeds. What's here is architecturally distinct from the LSTM
(attention instead of recurrence, direct multi-horizon instead of iterative
rollout) and is genuinely trained on live data — not a fabricated number
under a model name nothing produced. Swap this function's body for
pytorch_forecasting.TemporalFusionTransformer against the same DataFrame if
the full architecture is ever needed.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import torch
from torch import nn

LOOKBACK = 14
FEATURES = ["units_sold", "dow_sin", "dow_cos", "promo_flag", "is_holiday", "local_event_flag", "temperature_c"]


def _build_features(history: pd.DataFrame) -> pd.DataFrame:
    df = history.copy().sort_values("date").reset_index(drop=True)
    df["date"] = pd.to_datetime(df["date"])
    df["dow_sin"] = np.sin(2 * np.pi * df["date"].dt.dayofweek / 7)
    df["dow_cos"] = np.cos(2 * np.pi * df["date"].dt.dayofweek / 7)
    for col in ("promo_flag", "is_holiday", "local_event_flag"):
        df[col] = df[col].astype(float) if col in df.columns else 0.0
    df["temperature_c"] = df["temperature_c"].fillna(0.0) if "temperature_c" in df.columns else 0.0
    return df


def _normalize(df: pd.DataFrame):
    stats = {c: (float(df[c].mean()), float(df[c].std()) or 1.0) for c in FEATURES}
    out = df.copy()
    for c in FEATURES:
        mean, std = stats[c]
        out[c] = (out[c] - mean) / std
    return out, stats


def _band(resid_std: float, units_std: float) -> float:
    return resid_std * units_std * 1.28  # ~80% band around the point forecast, from live training residuals


def _in_sample_mape(pred_units: np.ndarray, actual_units: np.ndarray) -> float | None:
    """MAPE against the training window itself — computed from the same
    forward pass already run for training, so it costs nothing extra (no
    second training run). This is a training-fit metric, not a held-out
    backtest — labeled as such wherever it's shown."""
    mask = actual_units != 0
    if not mask.any():
        return None
    return float((np.abs((actual_units[mask] - pred_units[mask]) / actual_units[mask])).mean() * 100)


class _LSTMForecaster(nn.Module):
    def __init__(self, n_features: int, hidden: int = 32):
        super().__init__()
        self.lstm = nn.LSTM(n_features, hidden, num_layers=1, batch_first=True)
        self.head = nn.Linear(hidden, 1)

    def forward(self, x):
        out, _ = self.lstm(x)
        return self.head(out[:, -1, :]).squeeze(-1)


def train_and_forecast_lstm(history: pd.DataFrame, horizon_days: int = 7) -> pd.DataFrame:
    min_rows = LOOKBACK + 10
    if len(history) < min_rows:
        raise NotImplementedError(f"LSTM needs at least {min_rows} days of sales history for this store/category — only {len(history)} available yet.")

    df = _build_features(history)
    norm, stats = _normalize(df)
    arr = norm[FEATURES].to_numpy(dtype=np.float32)

    xs, ys = [], []
    for i in range(LOOKBACK, len(arr)):
        xs.append(arr[i - LOOKBACK:i])
        ys.append(arr[i, 0])
    X, y = np.array(xs, dtype=np.float32), np.array(ys, dtype=np.float32)

    torch.manual_seed(42)
    model = _LSTMForecaster(n_features=len(FEATURES))
    opt = torch.optim.Adam(model.parameters(), lr=0.01)
    loss_fn = nn.MSELoss()
    Xt, yt = torch.from_numpy(X), torch.from_numpy(y)

    model.train()
    for _ in range(50):
        opt.zero_grad()
        loss = loss_fn(model(Xt), yt)
        loss.backward()
        opt.step()

    model.eval()
    with torch.no_grad():
        fitted = model(Xt).numpy()
    resid_std = float((fitted - y).std()) or 0.2

    units_mean, units_std = stats["units_sold"]
    train_mape = _in_sample_mape(fitted * units_std + units_mean, y * units_std + units_mean)
    window = arr[-LOOKBACK:].copy()
    dow = int(df["date"].iloc[-1].dayofweek)
    preds = []
    for _ in range(horizon_days):
        with torch.no_grad():
            next_norm = model(torch.from_numpy(window[None, :, :])).item()
        preds.append(next_norm * units_std + units_mean)

        dow = (dow + 1) % 7
        next_row = window[-1].copy()
        next_row[0] = next_norm  # feed the prediction back in as next step's "observed" value
        next_row[1] = np.sin(2 * np.pi * dow / 7)
        next_row[2] = np.cos(2 * np.pi * dow / 7)
        window = np.vstack([window[1:], next_row])

    band = _band(resid_std, units_std)
    dates = pd.date_range(df["date"].iloc[-1] + pd.Timedelta(days=1), periods=horizon_days)
    result = pd.DataFrame({
        "ds": dates,
        "yhat": [max(0.0, p) for p in preds],
        "yhat_lower": [max(0.0, p - band) for p in preds],
        "yhat_upper": [p + band for p in preds],
    })
    result.attrs["mape"] = train_mape
    return result


class _AttentionForecaster(nn.Module):
    """Small Transformer encoder + direct multi-horizon head."""
    def __init__(self, n_features: int, horizon: int, d_model: int = 32, nhead: int = 4):
        super().__init__()
        self.input_proj = nn.Linear(n_features, d_model)
        layer = nn.TransformerEncoderLayer(d_model=d_model, nhead=nhead, dim_feedforward=64, batch_first=True, dropout=0.1)
        self.encoder = nn.TransformerEncoder(layer, num_layers=1)
        self.head = nn.Linear(d_model, horizon)

    def forward(self, x):
        h = self.encoder(self.input_proj(x))
        return self.head(h[:, -1, :])  # (batch, horizon) — every horizon day in one forward pass


def train_and_forecast_tft(history: pd.DataFrame, horizon_days: int = 7) -> pd.DataFrame:
    min_rows = LOOKBACK + horizon_days + 10
    if len(history) < min_rows:
        raise NotImplementedError(f"TFT-style forecasting needs at least {min_rows} days of sales history for this store/category — only {len(history)} available yet.")

    df = _build_features(history)
    norm, stats = _normalize(df)
    arr = norm[FEATURES].to_numpy(dtype=np.float32)

    xs, ys = [], []
    for i in range(LOOKBACK, len(arr) - horizon_days + 1):
        xs.append(arr[i - LOOKBACK:i])
        ys.append(arr[i:i + horizon_days, 0])
    X, Y = np.array(xs, dtype=np.float32), np.array(ys, dtype=np.float32)
    if len(X) < 5:
        raise NotImplementedError("Not enough history to form multi-horizon training windows yet for TFT-style forecasting.")

    torch.manual_seed(42)
    model = _AttentionForecaster(n_features=len(FEATURES), horizon=horizon_days)
    opt = torch.optim.Adam(model.parameters(), lr=0.01)
    loss_fn = nn.MSELoss()
    Xt, Yt = torch.from_numpy(X), torch.from_numpy(Y)

    model.train()
    for _ in range(60):
        opt.zero_grad()
        loss = loss_fn(model(Xt), Yt)
        loss.backward()
        opt.step()

    model.eval()
    with torch.no_grad():
        fitted = model(Xt).numpy()
        pred_norm = model(torch.from_numpy(arr[-LOOKBACK:][None, :, :])).numpy()[0]
    resid_std = float((fitted - Y).std()) or 0.2

    units_mean, units_std = stats["units_sold"]
    train_mape = _in_sample_mape(fitted * units_std + units_mean, Y * units_std + units_mean)
    band = _band(resid_std, units_std)
    preds = [p * units_std + units_mean for p in pred_norm]
    dates = pd.date_range(df["date"].iloc[-1] + pd.Timedelta(days=1), periods=horizon_days)
    result = pd.DataFrame({
        "ds": dates,
        "yhat": [max(0.0, p) for p in preds],
        "yhat_lower": [max(0.0, p - band) for p in preds],
        "yhat_upper": [p + band for p in preds],
    })
    result.attrs["mape"] = train_mape
    return result
