"""
Entry point. Run locally with:

    uvicorn app.main:app --reload

which serves interactive docs at http://localhost:8000/docs
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import alerts, analytics, assistant, auth, customer, forecast, inventory, notifications, pos, procurement, stores, tasks, team, warehouse

app = FastAPI(
    title=settings.app_name,
    description=(
        "API behind the RetailMind AI prototype: inventory & shelf monitoring, "
        "food quality/expiry, demand forecasting, supplier & purchase-order "
        "workflow, team/IAM, and store analytics."
    ),
    version="0.1.0",
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


@app.on_event("startup")
def on_startup():
    # Creates tables if they don't exist yet. Fine for local dev; use
    # Alembic migrations (see README) for anything resembling production.
    Base.metadata.create_all(bind=engine)

    # PyTorch's first forward pass on a fresh process pays a one-time
    # thread-pool/backend init cost (~5s) — pay it now at boot instead of on
    # the first user's forecast request.
    import torch
    with torch.no_grad():
        torch.nn.Linear(4, 4)(torch.zeros(1, 4))


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "environment": settings.environment}
