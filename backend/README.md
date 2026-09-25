# RetailMind AI — Backend

FastAPI backend behind the RetailMind AI prototype. This implements the
database schema and API contract the React prototype (`retailmind_prototype.jsx`)
was designed against — same store names, same team members, same suppliers —
so the two demo the same story from two different layers.

## What's real here vs. what's stubbed

**Real, correct, and ready to run once you add infrastructure:**
- Full PostgreSQL schema (`app/models.py`) — stores, IAM/users, products,
  batches (FEFO expiry tracking), suppliers, purchase orders, alerts,
  tasks, sales history
- JWT auth + RBAC matching the frontend's Admin-vs-Associate gating exactly
  (`app/security.py`) — including per-responsibility gates like
  `Purchase Approvals`, not just a blanket admin/staff split
- REST API for every module with a UI screen — team/IAM, stores, inventory,
  alerts, procurement, forecast, analytics
- Prophet and XGBoost forecasters (`app/ml/`) written against their real
  APIs — correct feature engineering, correct training calls

**Deliberately stubbed, not faked:**
- `app/ml/forecast_lstm_tft.py` raises `NotImplementedError` — these need
  PyTorch (+ pytorch-forecasting) and a real training pipeline, which is a
  separate project phase, not something to fake with the wrong tool. The
  `/forecast` router returns a `501` for these until that exists, rather
  than silently substituting fabricated numbers.
- Nothing in this repo has been executed against a live database — this
  sandbox has no network access, so there's no Postgres/Redis to connect
  to and no way to `pip install` the dependencies here. Every file has
  been syntax-checked (`python -m py_compile`), not integration-tested.
- CV inference (YOLO/SAM/ViT reading a real camera feed) isn't part of
  this repo at all — `alerts` is written as the table that service would
  write into, not the service itself.

## Running it locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# start Postgres + Redis however you prefer, e.g.:
docker run -d -p 5432:5432 -e POSTGRES_USER=retailmind -e POSTGRES_PASSWORD=retailmind -e POSTGRES_DB=retailmind postgres:16
docker run -d -p 6379:6379 redis:7

cp .env.example .env   # then edit DATABASE_URL/JWT_SECRET if needed

python -m app.seed              # creates tables + demo data
uvicorn app.main:app --reload   # → http://localhost:8000/docs
```

Demo logins after seeding (all use password `demo1234`):
| Email | Role |
|---|---|
| marcus@retailmind.demo | Admin (Store Incharge) |
| priya@retailmind.demo | Manager (Inventory & Shelf Lead) |
| diego@retailmind.demo | Staff (Procurement Associate) |
| layla@example.com | Customer |

## Project layout

```
app/
  main.py              FastAPI app, router registration, /health
  config.py            Settings from environment / .env
  database.py          SQLAlchemy engine/session
  models.py            ORM schema (all 12 modules' data)
  schemas.py           Pydantic request/response contracts
  security.py          JWT + RBAC dependencies
  seed.py              Demo data matching the frontend prototype
  routers/
    auth.py            POST /auth/login
    team.py            IAM — list/add/remove staff, RBAC-gated
    stores.py          Store list (powers the Enterprise picker)
    inventory.py       Products, FEFO expiring-soon query
    alerts.py          CCTV/CV alert feed, mark-reviewed
    procurement.py     Suppliers, PO list/approve/reject
    forecast.py        Prophet/XGBoost/LSTM/TFT behind one endpoint
    analytics.py       Admin-only KPIs, trends, store comparison
  ml/
    forecast_prophet.py    Real Prophet training/predict
    forecast_xgboost.py    Real XGBoost feature engineering + training
    forecast_lstm_tft.py   Documented interface, NotImplementedError
```

## Not in this scaffold (next phases)

- Alembic migration files (schema is currently created via
  `Base.metadata.create_all`, fine for local dev, not for production)
- The CV inference service itself (a separate process/repo that writes
  into the `alerts` table — this API only serves what it produces)
- LSTM/TFT training pipeline
- Docker Compose / deployment config
- Rate limiting, request logging, structured observability
