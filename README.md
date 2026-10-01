# RetailMind

[![CI](https://github.com/paulelisha500-ops/retailmind/actions/workflows/ci.yml/badge.svg)](https://github.com/paulelisha500-ops/retailmind/actions/workflows/ci.yml)
[![CodeQL](https://github.com/paulelisha500-ops/retailmind/actions/workflows/codeql.yml/badge.svg)](https://github.com/paulelisha500-ops/retailmind/actions/workflows/codeql.yml)
[![Live on GitHub Pages](https://img.shields.io/badge/live-GitHub%20Pages-2e7d4f)](https://paulelisha500-ops.github.io/retailmind/)
[![Live on Hugging Face](https://img.shields.io/badge/live-Hugging%20Face-ffd21e)](https://huggingface.co/spaces/Elisha622/retailmind)

Forecasting, procurement, shelf alerts, a register with loyalty, warehouse planning, analytics with profit and
loss, and a customer app — one retail operations console that **runs entirely in your browser**.

**Open it:** [GitHub Pages](https://paulelisha500-ops.github.io/retailmind/) ·
[Hugging Face Space](https://huggingface.co/spaces/Elisha622/retailmind) ·
[source](https://github.com/paulelisha500-ops/retailmind)

There is no server to wait for and no account to create. The whole backend — database, sign-in, permissions,
forecasting — is part of the page, so the same files host for free on GitHub Pages, a Hugging Face static
Space, or any static host. A server edition (FastAPI on SQLite or PostgreSQL) serves the same interface for teams that
want one shared database. Nothing here needs Docker.

## What it does

| | |
|---|---|
| **Cashier** | Search by name, SKU or barcode (a scanner's Enter adds the item), live totals, loyalty lookup and in-store enrolment, points redeemed against the bill, six tenders (cash with change due, card, Apple Pay, Google Pay, Samsung Pay, Tabby), receipts, and a customer directory with order history. |
| **Forecast** | Weekly demand per category and store with four methods — seasonal, boosted trees, LSTM and attention — a 90% likely range, an accuracy score measured on the last seven days the method never saw, and a suggested reorder quantity. |
| **Procurement** | Purchase orders approved by people who hold the approval responsibility, supplier scorecards and onboarding records, outreach to suppliers that is logged on every click, products with landed cost and margin, and CSV import for both. |
| **Monitoring** | Shelf fill by aisle computed from live stock, a review queue for stock, quality and loss-prevention alerts that a person always closes, and a camera source (this device or an IP camera URL). |
| **Warehouse** | Zone utilisation, a replenishment pick route by aisle, floor traffic by hour, and a staffing recommendation. |
| **Analytics** | KPIs, fast movers with days of supply, waste by category, regional comparison, and a trading profit and loss computed from orders and cost. |
| **Ask RetailMind** | Answers composed from live inventory, suppliers, sales and alerts. No language model is involved, so every sentence traces back to a record. |
| **Team & Access** | Add and remove people, roles (admin, manager, staff), per-module responsibilities, a one-time temporary password, and single-store or enterprise mode across four stores. |
| **Customer app** | Loyalty points and tier, offers, personal recommendations, product search with nutrition and allergens, a shopping list, self-checkout, receipts, and a preferred store. |

Sign in from the landing page — the workspace accounts are listed on the sign-in screen (admin, manager, staff
and customer), and each role sees a different set of screens and permissions.

## How it is built

```
                      ┌─────────────────────────── the page ───────────────────────────┐
  React UI  ──────►   │  api.js ──► engine worker                                      │
  (hash routing,      │             router ─► handlers ─► in-memory tables            │
   lazy screens,      │             JWT + PBKDF2 (WebCrypto) · roles and responsibilities│
   custom charts)     │             forecasting worker (seasonal, trees, LSTM, attention)│
                      │                         │                                       │
                      │             IndexedDB snapshot ◄─► other tabs (BroadcastChannel)│
                      └─────────────────────────────────────────────────────────────────┘
                      service worker: the app shell and every script are cached, so it opens offline
```

- **The engine answers the same REST surface as the server.** Requests are `{method, path, query, body}`
  messages to a Web Worker that returns `{status, body}`; validation errors, authorisation order and status codes
  follow FastAPI's. Switching editions is one environment variable (`VITE_BACKEND=server`).
- **Real authentication, locally.** Passwords are PBKDF2-SHA256 (150,000 rounds) and sessions are HS256 JWTs, both
  on WebCrypto; failed sign-ins are rate limited per email and per client; access is checked by role and by
  responsibility before any input is validated.
- **Forecasting runs in the browser.** A seasonal ridge regression with a prediction band, gradient-boosted trees,
  and an LSTM and a small Transformer encoder on a hand-written reverse-mode autodiff, trained on the store's own
  history in a worker (a couple of seconds for the networks) and cached per history. These are compact
  implementations of those method families, not the Python libraries.
- **Persistence.** The workspace is saved to IndexedDB shortly after each change, flushed when the page is hidden,
  and shared between tabs. Timestamps move forward with the calendar when the app is reopened, so "last 7 days"
  and expiry countdowns stay meaningful.

## Speed

Measured with `frontend/scripts/bench-load.mjs` against the original interface (commit `d1688ff`): headless Chrome,
each build served gzip-compressed like a static host, builds interleaved, median of 7 first visits.

| First visit | original | now |
|---|---|---|
| Transferred | 594 kB | **79 kB** |
| JavaScript | 198 kB | **62 kB** |
| Largest paint, desktop | 844 ms | **324 ms** |
| Largest paint, slow 3G (400 kbps, 400 ms RTT) | 5.3 s | **1.7 s** |
| Largest paint, phone (4× CPU, 1.6 Mbps, 150 ms RTT) | 13.3 s | **4.0 s** |

The landing page is rendered into `index.html` at build time, so a first visit paints from the HTML and CSS alone
(23–36% sooner than the same build without it), and its buttons are real links that work before any script arrives.
Screens are separate chunks fetched on demand and warmed while the browser is idle; the service worker makes repeat
visits instant and works offline. A cold sign-in takes about 0.6 s: the built-in accounts' password hash is
precomputed, so nothing is derived on first launch, and the first save never sits on the request path. Controls
respond instantly and are put back only if a change is refused. The figures compare builds with one another on one
machine; they are not a promise about any particular phone.

## Tested

- **126 unit tests** drive the engine through its public API: validation, authorisation, every router, the
  forecasting methods, persistence and clock alignment.
- **End-to-end tests** run the production build in a real browser at desktop and phone sizes, and offline.
  `scripts/interactive-census.mjs` lists every button, field and control in the source (165 test ids), and
  `scripts/coverage-gate.mjs` fails the build unless **each one — and each one ever rendered — was exercised**.
- **Accessibility**: axe-core (WCAG 2.1 A and AA plus best practice) audits every screen in light and dark, the
  dialogs and error states, and the phone layout.
- **Server edition**: backend tests pin the same contract the browser engine is tested against, on SQLite and on
  PostgreSQL, and the real Prophet, XGBoost and PyTorch forecasters run in their own workflow.
- CI (`.github/workflows/ci.yml`) lints, runs all of the above, and publishes the build that passed to GitHub Pages.

## Run it

```bash
cd frontend
npm install
npm run dev          # http://localhost:3002 — the browser edition
npm test             # unit tests
npm run test:e2e     # builds, serves and drives the production bundle
npm run build        # frontend/dist: static files for any host
```

**Server edition** (one shared database, real forecasting libraries). It needs Python, not Docker:

```bash
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-base.txt                  # or requirements.txt, to add Prophet, XGBoost and PyTorch
cp .env.example .env                                  # set JWT_SECRET: python -c "import secrets; print(secrets.token_hex(32))"
python -m app.seed && uvicorn app.main:app --port 8002   # a local SQLite file; http://localhost:8002/docs
cd ../frontend && npm run dev:server
```

PostgreSQL works too (set `DATABASE_URL`), and `docker compose up -d` is there if you would rather have containers.
See [`backend/README.md`](backend/README.md) for the API and its configuration.

## CI/CD

Everything below runs on free tiers: GitHub-hosted runners (free for public repositories), GitHub Pages, and a
static Hugging Face Space.

```
push / pull request ─► build: lint · unit tests · production build ──┐
                                                                      ├─► 3 test shards: desktop, phone, offline, accessibility
                                                                      │       │
                              every control exercised? (the gate) ◄───┘       │
                                          │                                   │
   push to main only ─────────────────────┴─► GitHub Pages  ─► check the live files match the tested build
                                          └─► Hugging Face  ─► check the live files match the tested build
```

- **One build, tested and shipped.** The site is built once; the test shards run against that artifact and the deploy
  jobs publish that same artifact, then download the live files and compare them byte for byte
  (`deploy/verify_live.py`).
- **Pull requests** run everything except publishing, with sharded browser tests (about 4 minutes of wall time).
- **Security:** CodeQL on every push and weekly, Dependabot for npm, pip, Docker and the workflows themselves.
- **Releases:** pushing a tag like `v1.2.0` attaches the built site to a GitHub release with generated notes.
- **Hugging Face from CI** needs one secret: a write token saved as the `HF_TOKEN` repository secret
  (Settings → Secrets and variables → Actions). Without it that job reports a notice and is skipped.

## Deploy by hand

| Where | How |
|---|---|
| GitHub Pages | Automatic from CI. Manually: `python deploy/github_pages.py` pushes `frontend/dist` to the `gh-pages` branch. |
| Hugging Face Space | `cd frontend && npm run build && cd .. && python deploy/hf_space.py` publishes a static Space (free; uses the token from `hf auth login`). `python deploy/hf_mirror.py` keeps the source repo beside it in step. |
| Any static host | Upload `frontend/dist` — the build uses relative paths, so it works at a domain root or under a sub-path. |
| Docker Space (server edition) | `deploy/docker-space/` packages the API, PostgreSQL and console in one container. Hugging Face only runs Docker Spaces on paid hardware, so the static Space is the free route. |

After any deployment, `python deploy/verify_live.py <url>` confirms the live site serves exactly the files in
`frontend/dist`.

## Limits worth knowing

- **Browser edition data is per browser.** It survives reloads and works offline, but clearing site data resets
  it, and there is no sync between devices or people — use the server edition for a shared workspace.
- **Integrations are not connected.** The camera screen shows a live feed, but detection is not included: alerts
  are records a person reviews. Supplier email and calls are logged, not sent, until a provider is configured
  (the server edition reads SMTP and Twilio settings). Payment tenders record how the till was settled; no card
  or wallet is processed.
- **Forecasting accuracy depends on the data.** Four months of seeded history is enough to compare methods and
  exercise the whole workflow; a real store would load its own sales through the CSV import or the server edition.

## Layout

```
frontend/   the app — React, the in-browser engine (src/engine), tests, build scripts
backend/    the server edition — FastAPI, PostgreSQL, Prophet, XGBoost, PyTorch
deploy/     publishing: Hugging Face Space and mirror, GitHub Pages, live-site check, the Docker Space kit
.github/    CI/CD, CodeQL, release and Dependabot configuration, issue and pull-request templates
```

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).
