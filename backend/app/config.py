"""
Application settings, loaded from environment variables (or a .env file).
See .env.example for the full list of variables this expects.
"""
from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


INSECURE_JWT_SECRETS = {"change-me-in-production", "super_secret_dev_key_12345"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Core ---
    app_name: str = "RetailMind AI API"
    environment: str = "development"

    # --- Database (PostgreSQL — SKU master, batches, suppliers, orders, IAM) ---
    database_url: str = "postgresql+psycopg2://retailmind:retailmind@localhost:5432/retailmind"

    # --- Redis (live layer: shelf-fill %, open alert counts, session cache) ---
    redis_url: str = "redis://localhost:6379/0"

    # --- Auth ---
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 12  # 12h shift-length default

    # --- CORS (the React/Flutter clients that call this API) ---
    # If exposing the frontend through a temporary public tunnel again, add
    # that origin here — a quick tunnel gets a new random URL each time, so
    # it belongs in a local .env override rather than hardcoded.
    allowed_origins: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://localhost:3002"]

    # --- Supplier outreach providers (Module 5/6) — all optional. Leaving
    # these unset is a real, supported mode: app/services/outreach.py logs
    # every contact decision either way, and only actually sends/dials when
    # every required credential below is present. Never partially wired. ---
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_from_email: str | None = None

    @model_validator(mode="after")
    def _reject_known_jwt_secrets(self):
        if self.jwt_secret in INSECURE_JWT_SECRETS or len(self.jwt_secret) < 32:
            raise ValueError("JWT_SECRET is unset, too short, or a known placeholder — set a random 32+ character value in .env (openssl rand -hex 32)")
        return self


settings = Settings()
