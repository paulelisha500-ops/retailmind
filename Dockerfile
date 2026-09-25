FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# Split into separate layers so a flaky download of one large wheel
# (xgboost/prophet are 100s of MB) doesn't force re-downloading everything
# else, and so a successful layer stays cached across retries.
RUN pip install --no-cache-dir --timeout 120 --retries 10 \
    fastapi uvicorn[standard] python-multipart sqlalchemy psycopg2-binary \
    alembic pydantic pydantic-settings email-validator \
    python-jose[cryptography] "passlib[bcrypt]" "bcrypt<4.1" redis
RUN pip install --no-cache-dir --timeout 120 --retries 10 pandas numpy
RUN pip install --no-cache-dir --timeout 300 --retries 15 prophet
RUN pip install --no-cache-dir --timeout 300 --retries 15 "xgboost>=2.0,<2.1" "scikit-learn>=1.5"
# CPU-only build via the dedicated index — the default PyPI wheel bundles
# CUDA binaries and is far larger than needed for CPU inference/training.
RUN pip install --no-cache-dir --timeout 300 --retries 15 torch --index-url https://download.pytorch.org/whl/cpu

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
