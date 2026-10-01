#!/usr/bin/env bash
# Boots everything inside the Space container, then hands over to the API server.
#
# Runs as the unprivileged `user` (UID 1000). State is ephemeral on the free tier:
# a restart gives a fresh container, so the database is re-initialised and the demo
# data re-seeded (app.seed is a no-op if data already exists, e.g. with persistent storage).
set -euo pipefail

# Debian installs the PostgreSQL server binaries under a versioned directory off PATH.
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -n1)"
export PATH="$PGBIN:$PATH"

export PGDATA="${PGDATA:-$HOME/pgdata}"
PGSOCK="$HOME/pgsock"
mkdir -p "$PGSOCK"

# 1. PostgreSQL ------------------------------------------------------------------
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  echo "[boot] initialising PostgreSQL cluster in $PGDATA"
  initdb -D "$PGDATA" -U postgres -E UTF8 --locale=C.UTF-8 \
         --auth-local=trust --auth-host=scram-sha-256 >/dev/null
fi

echo "[boot] starting PostgreSQL"
pg_ctl -D "$PGDATA" -w -t 90 -l "$HOME/postgres.log" \
  -o "-c listen_addresses=127.0.0.1 -c unix_socket_directories=$PGSOCK -c max_connections=50" start >/dev/null

# Role + database matching the app's defaults (app/config.py). Loopback-only, never exposed.
psql_admin() { psql -h "$PGSOCK" -U postgres -v ON_ERROR_STOP=1 -tA "$@"; }
[ "$(psql_admin -c "SELECT 1 FROM pg_roles WHERE rolname='retailmind'")" = 1 ] \
  || psql_admin -c "CREATE ROLE retailmind LOGIN PASSWORD 'retailmind'" >/dev/null
[ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname='retailmind'")" = 1 ] \
  || psql_admin -c "CREATE DATABASE retailmind OWNER retailmind" >/dev/null

# 2. App settings ------------------------------------------------------------------
export DATABASE_URL="postgresql+psycopg2://retailmind:retailmind@127.0.0.1:5432/retailmind"
# JWT signing key: generated fresh each boot unless one is provided. Sessions don't need
# to outlive the ephemeral database anyway, and no secret ever lives in the repo.
export JWT_SECRET="${JWT_SECRET:-$(python -c 'import secrets; print(secrets.token_hex(32))')}"
# (REDIS_URL is configured in app/config.py but nothing in the backend imports redis,
#  so no Redis server is started here.)

# 3. Seed demo data, then serve UI + API on the Space port --------------------------
cd /app
echo "[boot] seeding demo data"
python -m app.seed

echo "[boot] starting API + UI on :${PORT:-7860}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-7860}"
