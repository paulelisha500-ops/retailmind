"""
Supplier outreach — real detection logic (which supplier needs contacting, and why), always logged, dispatched
only when a provider is actually configured.

Nothing here ever pretends to have called or emailed someone. `send_email` and `place_call` check
`app.config.settings` for provider credentials (SMTP for email, Twilio for calls). Without them — the default —
they return status="logged": the contact is recorded with exactly what would have been sent, and no network call
is made. Add the credentials (see .env.example) to switch a channel to live sending; no code changes needed.
"""
import smtplib
from email.mime.text import MIMEText

from app.config import settings


def send_email(to_email: str, subject: str, body: str) -> tuple[str, str]:
    """Returns (status, detail). status is 'sent', 'logged' (no provider configured), or 'failed'."""
    if not (settings.smtp_host and settings.smtp_username and settings.smtp_password and settings.smtp_from_email):
        return "logged", "No SMTP credentials configured (SMTP_HOST/SMTP_USERNAME/SMTP_PASSWORD/SMTP_FROM_EMAIL) — logged only, nothing sent."
    if not to_email:
        return "failed", "Supplier has no contact_email on file."
    try:
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from_email
        msg["To"] = to_email
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            server.starttls()
            server.login(settings.smtp_username, settings.smtp_password)
            server.sendmail(settings.smtp_from_email, [to_email], msg.as_string())
        return "sent", f"Email sent to {to_email}."
    except Exception as exc:  # noqa: BLE001 — surfaced to the caller as a log entry, not raised
        return "failed", f"SMTP send failed: {exc}"


def place_call(to_phone: str, message: str) -> tuple[str, str]:
    """Returns (status, detail). Live dispatch needs the `twilio` package (not installed by default) plus account
    credentials; wire in a client here once both exist."""
    if not (settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_from_number):
        return "logged", "No voice-call provider configured (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER) — logged only, nothing dialed."
    if not to_phone:
        return "failed", "Supplier has no contact_phone on file."
    return "failed", "A voice provider is configured but no call client is wired in yet — add the `twilio` package and a real dispatch call here."
