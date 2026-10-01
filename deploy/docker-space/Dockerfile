# Hugging Face Space (Docker SDK): the SERVER edition in one container —
# PostgreSQL + the FastAPI API + the built React console, all on port 7860.
#
# deploy/docker-space/deploy.py uploads this file as the Space's root /Dockerfile. The repo-root
# Dockerfile + docker-compose.yml are the separate local multi-container setup and
# are not used here. Build context = repo root (so both backend/ and frontend/ are visible).

# ---- 1. Build the React console ---------------------------------------------
FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# The server edition of the console: it talks to the API instead of running its own engine.
# VITE_API_URL="" means same origin - the API is served by the same process as the UI
# (see FRONTEND_DIST in backend/app/main.py).
ENV VITE_API_URL=""
RUN npm run build:server

# ---- 2. API + PostgreSQL + built UI -----------------------------------------
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        postgresql \
    && rm -rf /var/lib/apt/lists/*

# Spaces run the container as UID 1000, and PostgreSQL refuses to run as root.
RUN useradd -m -u 1000 user

WORKDIR /app

# Same dependency layers as the repo-root Dockerfile, kept separate so one flaky
# download of a large wheel (xgboost/prophet/torch) doesn't redo everything else.
RUN pip install --no-cache-dir --timeout 120 --retries 10 \
    fastapi uvicorn[standard] python-multipart sqlalchemy psycopg2-binary \
    alembic pydantic pydantic-settings email-validator \
    python-jose[cryptography] "passlib[bcrypt]" "bcrypt<4.1" redis
RUN pip install --no-cache-dir --timeout 120 --retries 10 pandas numpy
RUN pip install --no-cache-dir --timeout 300 --retries 15 prophet
RUN pip install --no-cache-dir --timeout 300 --retries 15 "xgboost>=2.0,<2.1" "scikit-learn>=1.5"
# CPU-only torch via the dedicated index (the default wheel bundles CUDA).
RUN pip install --no-cache-dir --timeout 300 --retries 15 torch --index-url https://download.pytorch.org/whl/cpu

COPY --chown=user:user backend/ /app/
COPY --from=ui --chown=user:user /ui/dist /app/static
COPY --chown=user:user deploy/docker-space/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

USER user
ENV HOME=/home/user \
    PYTHONPATH=/app \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIST=/app/static \
    ENVIRONMENT=production

EXPOSE 7860
CMD ["/app/entrypoint.sh"]
