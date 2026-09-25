# RetailMind AI

**Source:** [GitHub](https://github.com/paulelisha500-ops/retailmind) · [Hugging Face](https://huggingface.co/Elisha622/retailmind)

One project, two halves — now actually connected. Open `retailmind.code-workspace`
in VS Code (File → Open Workspace from File...) to see both folders in one
window instead of opening them separately.

## Quick start (Docker — recommended)

```bash
cp .env.example .env      # then set JWT_SECRET (openssl rand -hex 32) — compose refuses to start without it
docker compose up -d      # postgres + redis + backend, auto-seeded → http://localhost:8002/docs
cd frontend && npm install && npm run dev   # → http://localhost:3002
# optional: cp frontend/.env.example frontend/.env and set VITE_SALES_EMAIL for the Enterprise "Talk to us" button
```

Demo logins (password `demo1234` for all): `marcus@retailmind.demo` (Admin),
`priya@retailmind.demo` (Manager), `diego@retailmind.demo` (Staff),
`layla@example.com` (Customer, frontend-only — see below).

## frontend/ — the console

A React (Vite) desktop app — sidebar nav, not the old phone-mockup shell.
Talks to the real backend over `fetch` (`src/api.js`); no more hardcoded
mock arrays for anything the backend actually models.

## backend/ — the API

FastAPI + PostgreSQL: real schema, JWT/RBAC, real Prophet + XGBoost
forecasting trained live against `sales_records`, and a real (non-LLM)
multi-agent business assistant that queries Postgres directly per question.
Full setup instructions are in `backend/README.md`.

## What's real vs. still a frontend demo

**Connected to the real backend:** auth, team/IAM, stores, tasks, alerts
(CCTV command center), procurement (suppliers + purchase-order approval),
Prophet/XGBoost forecasting, admin analytics, and the AI business assistant.
Every mutation (resolve alert, toggle task, approve/reject PO, add/remove
team member) round-trips to Postgres and survives a reload.

**Deliberately still stubbed or frontend-only** (no backend module exists
for these yet — the UI says so where it matters, it doesn't fake it):
- LSTM/TFT forecasting — backend returns `501`, frontend shows that honestly
  instead of a fabricated chart
- Customer-facing screens (product scan, shopping list, offers, loyalty) —
  no product-catalog/loyalty backend yet
- Warehouse screen (zones, pick route, congestion) — no warehouse-sensor
  backend yet
- CCTV camera tiles — illustrative; there's no live camera feed service,
  only the alerts a CV pipeline would have written are real
- The full CV/OCR/NLP/LLM/RAG stack from the original spec (YOLO, SAM, ViT,
  LangChain, FAISS, etc.) — not implemented; the assistant above is a
  plain-Python multi-agent stand-in that queries the database directly
  rather than an LLM, by design (no external API key configured)

## Honesty check

Both halves have now actually been run, connected, and exercised end-to-end
in a browser — login, every CRUD action, real forecast charts, real
assistant answers — not just syntax-checked. See `backend/README.md` for
the per-module breakdown of what's production-shaped vs. scaffolded.
