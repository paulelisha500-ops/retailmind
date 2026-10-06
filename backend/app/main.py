"""
Entry point. Run locally with:

    uvicorn app.main:app --reload

which serves interactive docs at http://localhost:8000/docs
"""
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import Base, engine
from app.routers import (
    alerts,
    analytics,
    assistant,
    auth,
    customer,
    forecast,
    inventory,
    notifications,
    pos,
    procurement,
    stores,
    tasks,
    team,
    warehouse,
    workspace,
)


def on_startup():
    # Creates tables if they don't exist yet. Fine for local use; run Alembic migrations (see README) once the
    # schema needs to change under live data.
    Base.metadata.create_all(bind=engine)

    # PyTorch's first forward pass on a fresh process pays a one-time thread-pool/backend start-up cost (~5s) —
    # pay it now at boot instead of on the first forecast request. Skipped when PyTorch isn't installed.
    try:
        import torch
    except ImportError:
        return
    with torch.no_grad():
        torch.nn.Linear(4, 4)(torch.zeros(1, 4))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    on_startup()
    yield


app = FastAPI(
    title=settings.app_name,
    description=(
        "The RetailMind server edition: inventory and shelf monitoring, food quality and expiry, demand "
        "forecasting, supplier and purchase-order workflow, the register and loyalty, team and access, and "
        "store analytics. The browser edition answers the same API inside the page."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(team.router)
app.include_router(stores.router)
app.include_router(inventory.router)
app.include_router(alerts.router)
app.include_router(procurement.router)
app.include_router(forecast.router)
app.include_router(analytics.router)
app.include_router(tasks.router)
app.include_router(assistant.router)
app.include_router(customer.router)
app.include_router(warehouse.router)
app.include_router(notifications.router)
app.include_router(pos.router)
app.include_router(workspace.router)


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "environment": settings.environment}


# Single-origin deployment (the Hugging Face Space): when FRONTEND_DIST points at
# a built frontend, serve it from this same process so the UI and the API share
# one origin and one port. Mounted last, so every API route above wins. Unset
# (local dev / docker-compose) -> nothing is mounted and behaviour is unchanged.
_frontend_dist = os.environ.get("FRONTEND_DIST")
if _frontend_dist and Path(_frontend_dist).is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
