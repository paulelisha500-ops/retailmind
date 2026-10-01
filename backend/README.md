# RetailMind server edition

The retail operations API as a FastAPI service. It is the same API the **browser edition** answers inside the page,
so use this one when several people need to share a single workspace; the browser edition needs no server at all (see
the [root README](../README.md)). It runs on plain Python with a local SQLite file, and on PostgreSQL when you want a
shared database. Docker is optional.

The two editions are held to one contract. The server seeds the same starting workspace (the same random sequence,
drawn in the same order, so a fresh server and a fresh browser tab show the same stores, people, stock and sales
history), and every route, status code, validation message and calculation is pinned by tests on each side.

## What is in it

- **Data:** stores, team and permissions, products, batches (FEFO expiry tracking), suppliers, purchase orders, alerts,
  tasks, sales history, orders and loyalty (`app/models.py`).
- **Access:** JWT sign-in with role- and responsibility-based gates, so "Purchase Approvals" or "Inventory Monitoring"
  is a permission an admin grants, not a blanket admin/staff split (`app/security.py`). Failed sign-ins are rate
  limited per email and per address.
- **Routes:** team, stores, inventory (with CSV import), alerts, procurement (suppliers, reorder detection, supplier
  contact log, purchase-order approval), forecast, analytics and profit and loss, warehouse, the register, the customer
  app, the business assistant, notifications.
- **Forecasting:** four methods trained live on a store's own sales history: Prophet, XGBoost, an LSTM and an attention
  network. Prophet and XGBoost report a held-out backtest; the two networks report their fit on the training window and
  say so (`mape_kind`). Results are cached until the sales history changes. A method whose library is not installed
  answers `501`; the rest of the API does not need them.
- **Supplier outreach:** every contact is logged. A message is sent only when SMTP or Twilio credentials are present;
  otherwise the entry says it was logged and nothing was dispatched.

## Run it

You need Python 3.11 or newer. No database server, no Docker:

```bash
cd backend
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements-base.txt
cp .env.example .env                # then set JWT_SECRET: python -c "import secrets; print(secrets.token_hex(32))"
python -m app.seed                  # creates retailmind.db with the starting workspace
uvicorn app.main:app --port 8002    # API and docs at http://localhost:8002/docs
```

`requirements-base.txt` is the API without the heavy forecasting libraries; a forecasting method whose library is
missing answers `501` and the rest of the API is unaffected. For all four methods install `requirements.txt` instead
(Prophet, XGBoost and PyTorch are large downloads; on a CPU-only machine install PyTorch from
`https://download.pytorch.org/whl/cpu` first).

Point the web app at it with `npm run dev:server` in `frontend/` (it reads `frontend/.env.server`, which expects the
API on port 8002).

**PostgreSQL** for a shared database: set `DATABASE_URL=postgresql+psycopg2://user:password@host:5432/name` in `.env`
and run `python -m app.seed` once.

**Docker** is an optional way to get PostgreSQL and the API together, from the repository root:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build        # API and docs at http://localhost:8002/docs
```

The container runs without `--reload`, so restart it after editing backend code: `docker compose restart backend`.

Every seeded account signs in with the password `retailmind`:

| Email | Role |
|---|---|
| `marcus@retailmind.app` | Admin: store in-charge |
| `priya@retailmind.app` | Manager: inventory and shelf lead |
| `diego@retailmind.app` | Staff: procurement and register |
| `layla@members.retailmind.app` | Customer |

## Tests

```bash
pip install -r requirements-test.txt     # the API without the heavy forecasting libraries, plus pytest and ruff
pytest                                   # on a throwaway SQLite database
TEST_DATABASE_URL=postgresql+psycopg2://user:pass@localhost:5432/retailmind_test pytest   # on a PostgreSQL you have
ruff check .
```

Each test starts from a fresh copy of the seeded workspace. The tests that run the real forecasting methods
(`tests/test_forecast_models.py`) skip themselves when a library is missing; install `requirements.txt` to run them all.
CI runs the suite on both databases.

## Layout

```
app/
  main.py          FastAPI app, router registration, /health
  config.py        Settings from the environment or .env
  database.py      SQLAlchemy engine and session
  models.py        The relational schema
  schemas.py       Request and response contracts
  security.py      Password hashing, JWT, access dependencies
  seed.py          The starting workspace (also used to reset a throwaway deployment)
  routers/         One module per area of the API
  services/        Stock draw-down on a sale, supplier outreach
  ml/              The forecasting methods
tests/             The contract, per area, plus the real forecasting methods
```

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Defaults to a local SQLite file; a PostgreSQL URL gives you a shared database |
| `JWT_SECRET` | Required: 32 or more random characters. Placeholders are rejected at start-up |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Sign-in lifetime (default 720) |
| `ALLOWED_ORIGINS` | JSON list of web origins allowed to call the API |
| `ALLOW_WORKSPACE_RESET` | `true` enables `POST /workspace/reset`, which wipes the data and re-seeds it. Leave it off anywhere real data lives |
| `SMTP_*`, `TWILIO_*` | Optional outreach providers; see `.env.example` |

## Not included

- **Migrations.** The schema is created with `Base.metadata.create_all`, which is right for a fresh database; add
  Alembic revisions before changing the schema under live data.
- **Camera-based detection.** `alerts` is the table such a service would write into; this repository does not run one.
- **Redis.** The setting exists, but nothing in the API reads it yet.
