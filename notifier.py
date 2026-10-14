"""Email (SMTP) alerts for full bins.

Standard library only. This module never imports firebase_admin: the engine
reads/writes the database and hands plain dicts to the functions below, which
keeps all threshold, state and email logic pure and unit-testable.

Data contract (shared with the web app):
    settings/alerts   {enabled, recipients, criticalAt, rearmBelow, minIntervalMinutes}
    alertState/{bin}  {armed, lastNotifiedAt, lastFill}      (engine only)
    alertLog/{push}   {at, type, status, binIds, binLocations, recipients,
                       subject, error?}
"""
from __future__ import annotations

import html
import logging
import math
import os
import re
import smtplib
import ssl
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid, parseaddr
from typing import Any, Callable, Mapping

log = logging.getLogger("smartwaste.notifier")

DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": True,
    "recipients": [],
    "criticalAt": 90.0,
    "rearmBelow": 75.0,
    "minIntervalMinutes": 30.0,
}
SMTP_TIMEOUT_SECONDS = 20
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-']+@[A-Za-z0-9\-]+(\.[A-Za-z0-9\-]+)+$")

LIME = "#B0E454"
FOREST = "#224F10"
IVORY = "#EAFFD0"


class SendError(Exception):
    """Raised when an email could not be sent. The message never holds secrets."""


# --------------------------------------------------------------------------
# Environment / configuration
# --------------------------------------------------------------------------
def load_env_file(path: str = ".env", environ: dict[str, str] | None = None) -> bool:
    """Load KEY=VALUE lines from `path` into `environ` (os.environ by default).

    Blank lines and `#` comments are skipped; an optional `export ` prefix and
    one pair of surrounding quotes are stripped. Real environment variables win.
    Returns True when the file existed.
    """
    env = os.environ if environ is None else environ
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except OSError:
        return False
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key and key not in env:
            env[key] = value
    return True


@dataclass(frozen=True)
class SmtpConfig:
    host: str = "smtp.gmail.com"
    port: int = 587
    user: str = ""
    password: str = ""
    sender: str = ""
    security: str = "starttls"  # 'starttls' | 'ssl' | 'none'

    @property
    def configured(self) -> bool:
        return bool(self.user and self.password)

    def __repr__(self) -> str:  # never leak the password
        return (f"SmtpConfig(host={self.host!r}, port={self.port}, user={self.user!r}, "
                f"password={'***' if self.password else ''!r}, security={self.security!r})")


def smtp_config_from_env(env: Mapping[str, str] | None = None) -> SmtpConfig:
    env = os.environ if env is None else env
    user = env.get("SMTP_USER", "").strip()
    try:
        port = int(env.get("SMTP_PORT", "").strip() or 587)
    except ValueError:
        log.warning("SMTP_PORT is not a number; using 587.")
        port = 587
    security = (env.get("SMTP_SECURITY", "").strip() or "starttls").lower()
    if security not in ("starttls", "ssl", "none"):
        log.warning("SMTP_SECURITY must be starttls, ssl or none; using starttls.")
        security = "starttls"
    return SmtpConfig(
        host=env.get("SMTP_HOST", "").strip() or "smtp.gmail.com",
        port=port,
        user=user,
        password=env.get("SMTP_PASSWORD", ""),
        sender=env.get("SMTP_FROM", "").strip() or user,
        security=security,
    )


# --------------------------------------------------------------------------
# Settings
# --------------------------------------------------------------------------
def valid_email(value: Any) -> bool:
    return isinstance(value, str) and bool(EMAIL_RE.match(value.strip()))


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, str):
        return [p for p in value.split(",")]
    if isinstance(value, Mapping):  # Firebase turns sparse arrays into dicts
        return list(value.values())
    if isinstance(value, (list, tuple, set)):
        return list(value)
    return []


def clean_recipients(value: Any) -> list[str]:
    """Trim, validate and de-duplicate addresses; invalid ones are logged and dropped."""
    out: list[str] = []
    for item in _as_list(value):
        text = item.strip() if isinstance(item, str) else item
        if text in ("", None):
            continue
        if not valid_email(text):
            log.warning("Ignoring invalid alert recipient: %r", text)
        elif text not in out:
            out.append(text)
    return out


def _number(value: Any, default: float, low: float, high: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    if not math.isfinite(value) or not low <= value <= high:
        return default
    return float(value)


def normalize_settings(raw: Any, env: Mapping[str, str] | None = None) -> dict[str, Any]:
    """Merge `settings/alerts` over the defaults. Never raises."""
    env = os.environ if env is None else env
    raw = raw if isinstance(raw, Mapping) else {}
    d = DEFAULT_SETTINGS
    enabled = raw.get("enabled", d["enabled"])
    critical = _number(raw.get("criticalAt"), d["criticalAt"], 1, 100)
    rearm = _number(raw.get("rearmBelow"), d["rearmBelow"], 0, 100)
    recipients = clean_recipients(raw.get("recipients"))
    if not recipients:
        recipients = clean_recipients(env.get("ALERT_TO", ""))
    return {
        "enabled": enabled if isinstance(enabled, bool) else d["enabled"],
        "recipients": recipients,
        "criticalAt": critical,
        # Re-arming above the trigger level would make a bin flap every run.
        "rearmBelow": min(rearm, critical),
        "minIntervalMinutes": _number(raw.get("minIntervalMinutes"),
                                      d["minIntervalMinutes"], 0, 60 * 24 * 30),
    }


# --------------------------------------------------------------------------
# Decision logic
# --------------------------------------------------------------------------
def parse_fill(value: Any) -> float | None:
    """A usable fill level is a finite number in 0..100; anything else is None."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or not 0 <= value <= 100:
        return None
    return float(value)


def decide_alerts(
    bins: Mapping[str, Mapping[str, Any]],
    states: Mapping[str, Mapping[str, Any]] | None,
    settings: Mapping[str, Any],
    now: float,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]]]:
    """Edge-triggered alert decision. `now` is epoch milliseconds.

    Returns (due_bins, new_states). `new_states` holds only the bins whose state
    changed here (re-arming, lastFill); due bins are NOT disarmed - call
    mark_sent() after a successful send so a failed send retries next run.
    """
    states = states or {}
    critical = settings["criticalAt"]
    rearm = settings["rearmBelow"]
    interval_ms = settings["minIntervalMinutes"] * 60_000
    due: list[dict[str, Any]] = []
    new_states: dict[str, dict[str, Any]] = {}

    for bin_id, data in (bins or {}).items():
        if not isinstance(data, Mapping):
            continue
        fill = parse_fill(data.get("fillLevel"))
        if fill is None:
            continue
        state = states.get(bin_id)
        state = dict(state) if isinstance(state, Mapping) else None

        if state is not None and state.get("armed") is False and fill < rearm:
            state["armed"] = True
            state["lastFill"] = fill
            new_states[bin_id] = state
            continue

        if fill < critical:
            continue
        armed = state is None or state.get("armed", True) is not False
        last = state.get("lastNotifiedAt") if state else None
        waited = (not isinstance(last, (int, float)) or isinstance(last, bool)
                  or now - last >= interval_ms)
        if armed and waited:
            due.append({
                "id": bin_id,
                "location": str(data.get("location") or bin_id),
                "fillLevel": fill,
                "prediction": str(data.get("prediction") or ""),
            })
    due.sort(key=lambda b: (-b["fillLevel"], b["id"]))
    return due, new_states


def mark_sent(
    states: Mapping[str, Mapping[str, Any]] | None,
    due_bins: list[Mapping[str, Any]],
    now: float,
) -> dict[str, dict[str, Any]]:
    """State updates to store after a SUCCESSFUL send."""
    out: dict[str, dict[str, Any]] = {}
    for b in due_bins:
        out[b["id"]] = {"armed": False, "lastNotifiedAt": int(now), "lastFill": b["fillLevel"]}
    return out


# --------------------------------------------------------------------------
# Message building
# --------------------------------------------------------------------------
def build_subject(count: int) -> str:
    if count == 1:
        return "SmartWaste: 1 bin is full and needs collection"
    return f"SmartWaste: {count} bins are full and need collection"


def _fmt_fill(value: float) -> str:
    return f"{value:.0f}%" if float(value).is_integer() else f"{value:.1f}%"


def _resources_line(resources: Mapping[str, Any] | None) -> str:
    if not isinstance(resources, Mapping):
        return ""
    trucks, dist = resources.get("trucksAllocated"), resources.get("routeDistanceKm")
    if trucks is None and dist is None:
        return ""
    parts = []
    if trucks is not None:
        parts.append(f"{trucks} truck{'s' if trucks != 1 else ''}")
    if dist is not None:
        parts.append(f"{dist} km route")
    return "Planned collection: " + ", ".join(parts) + "."


def build_message(
    due_bins: list[Mapping[str, Any]],
    recipients: list[str],
    sender: str,
    resources: Mapping[str, Any] | None = None,
    dashboard_url: str = "",
    now: float | None = None,
) -> EmailMessage:
    """Multipart/alternative email (plain text + inline-styled HTML) for due bins."""
    subject = build_subject(len(due_bins))
    route = _resources_line(resources)
    url = (dashboard_url or "").strip()

    text = [subject, "", f"{'Location':<32} {'Fill':>6}  Prediction", "-" * 60]
    for b in due_bins:
        text.append(f"{b['location'][:32]:<32} {_fmt_fill(b['fillLevel']):>6}  {b.get('prediction', '')}")
    text.append("")
    if route:
        text += [route, ""]
    if url:
        text += [f"Open the dashboard: {url}", ""]
    text.append("You receive this because you are an alert recipient in SmartWaste settings.")

    cell = "padding:8px 12px;border-bottom:1px solid #d6eab0;text-align:left;"
    rows = "".join(
        f"<tr><td style=\"{cell}\">{html.escape(str(b['location']))}</td>"
        f"<td style=\"{cell}font-weight:bold;\">{html.escape(_fmt_fill(b['fillLevel']))}</td>"
        f"<td style=\"{cell}\">{html.escape(str(b.get('prediction', '')))}</td></tr>"
        for b in due_bins
    )
    head = f"padding:8px 12px;text-align:left;background:{FOREST};color:{IVORY};"
    body = (
        f"<div style=\"font-family:Arial,Helvetica,sans-serif;background:{IVORY};padding:24px;\">"
        f"<div style=\"max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;"
        f"overflow:hidden;\">"
        f"<div style=\"background:{LIME};color:{FOREST};padding:16px 20px;font-size:18px;"
        f"font-weight:bold;\">{html.escape(subject)}</div>"
        f"<div style=\"padding:20px;color:{FOREST};font-size:14px;\">"
        f"<table style=\"border-collapse:collapse;width:100%;font-size:14px;\">"
        f"<tr><th style=\"{head}\">Location</th><th style=\"{head}\">Fill %</th>"
        f"<th style=\"{head}\">Prediction</th></tr>{rows}</table>"
    )
    if route:
        body += f"<p style=\"margin:16px 0 0;\">{html.escape(route)}</p>"
    if url:
        safe = html.escape(url, quote=True)
        body += (f"<p style=\"margin:16px 0 0;\"><a href=\"{safe}\" style=\"display:inline-block;"
                 f"background:{FOREST};color:{IVORY};padding:10px 16px;border-radius:6px;"
                 f"text-decoration:none;\">Open dashboard</a></p>")
    body += ("<p style=\"margin:20px 0 0;font-size:12px;color:#5a7a45;\">You receive this because "
             "you are an alert recipient in SmartWaste settings.</p></div></div></div>")

    return _assemble(subject, sender, recipients, "\n".join(text), body)


def build_test_message(recipients: list[str], sender: str, now: float | None = None) -> EmailMessage:
    subject = "SmartWaste: TEST email (no action needed)"
    text = ("This is a TEST message from the SmartWaste alert engine.\n"
            "If you can read this, email alerts are configured correctly. "
            "No bin is actually full.")
    body = (f"<div style=\"font-family:Arial,Helvetica,sans-serif;background:{IVORY};padding:24px;\">"
            f"<div style=\"max-width:560px;margin:0 auto;background:#fff;border-radius:8px;\">"
            f"<div style=\"background:{LIME};color:{FOREST};padding:16px 20px;font-weight:bold;\">"
            f"{html.escape(subject)}</div><p style=\"padding:0 20px 20px;color:{FOREST};\">"
            f"{html.escape(text)}</p></div></div>")
    return _assemble(subject, sender, recipients, text, body)


def _assemble(subject: str, sender: str, recipients: list[str], text: str, html_body: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)
    msg["Date"] = formatdate(localtime=False)
    address = parseaddr(sender)[1]
    domain = address.rsplit("@", 1)[-1] if "@" in address else None
    msg["Message-ID"] = make_msgid(domain=domain)
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    return msg


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------
def _scrub(text: str, config: SmtpConfig) -> str:
    if config.password:
        text = text.replace(config.password, "***")
    return " ".join(text.split())[:200]


def send_message(msg: EmailMessage, config: SmtpConfig) -> None:
    """Send via SMTP with certificate verification. Raises SendError (no secrets)."""
    if not config.configured:
        raise SendError("SMTP is not configured")
    context = ssl.create_default_context()
    server = None
    try:
        if config.security == "ssl":
            server = smtplib.SMTP_SSL(config.host, config.port,
                                      timeout=SMTP_TIMEOUT_SECONDS, context=context)
        else:
            server = smtplib.SMTP(config.host, config.port, timeout=SMTP_TIMEOUT_SECONDS)
            if config.security == "starttls":
                server.starttls(context=context)
        server.login(config.user, config.password)
        server.send_message(msg)
        try:
            server.quit()
        except Exception:  # noqa: BLE001 - message already accepted
            pass
    except Exception as exc:  # noqa: BLE001 - normalised below
        raise SendError(_scrub(f"{type(exc).__name__}: {exc}", config)) from None
    finally:
        if server is not None:
            try:
                server.close()
            except Exception:  # noqa: BLE001
                pass


# --------------------------------------------------------------------------
# Orchestration (pure: returns what the engine should write)
# --------------------------------------------------------------------------
def build_log_entry(
    kind: str, status: str, due_bins: list[Mapping[str, Any]], recipients: list[str],
    subject: str, now: float, error: str | None = None,
) -> dict[str, Any]:
    entry: dict[str, Any] = {
        "at": int(now),
        "type": kind,
        "status": status,
        "binIds": [b["id"] for b in due_bins],
        "binLocations": [b["location"] for b in due_bins],
        "recipients": list(recipients),
        "subject": subject,
    }
    if error:
        entry["error"] = error
    return entry


@dataclass
class AlertOutcome:
    state_updates: dict[str, dict[str, Any]]
    log_entry: dict[str, Any] | None = None


def process_alerts(
    bins: Mapping[str, Mapping[str, Any]],
    states: Mapping[str, Mapping[str, Any]] | None,
    raw_settings: Any,
    config: SmtpConfig,
    resources: Mapping[str, Any] | None = None,
    dashboard_url: str = "",
    now: float | None = None,
    dry_run: bool = False,
    sender: Callable[[EmailMessage, SmtpConfig], None] = send_message,
    env: Mapping[str, str] | None = None,
) -> AlertOutcome:
    """Decide, send and report. Never raises; the engine persists the outcome."""
    now = time.time() * 1000 if now is None else now
    settings = normalize_settings(raw_settings, env)
    due, updates = decide_alerts(bins, states, settings, now)
    if not due:
        return AlertOutcome(updates)

    recipients = settings["recipients"]
    subject = build_subject(len(due))

    def entry(status: str, error: str | None = None) -> dict[str, Any]:
        return build_log_entry("critical", status, due, recipients, subject, now, error)

    if dry_run:
        print(f"[dry-run] Would email {', '.join(recipients) or '(no recipients)'}: {subject}")
        for b in due:
            print(f"[dry-run]   {b['location']}: {_fmt_fill(b['fillLevel'])} {b['prediction']}")
        if not settings["enabled"]:
            print("[dry-run] (alerts are disabled in settings, nothing would be sent)")
        elif not config.configured:
            print("[dry-run] (SMTP is not configured, the real send would fail)")
        return AlertOutcome({})

    if not settings["enabled"]:
        log.info("%d bin(s) due but alerts are disabled.", len(due))
        return AlertOutcome(updates, entry("skipped", "Alerts are disabled"))
    if not recipients:
        log.warning("%d bin(s) due but there are no valid recipients "
                    "(set them in settings or ALERT_TO).", len(due))
        return AlertOutcome(updates, entry("skipped", "No recipients configured"))
    if not config.configured:
        log.error("SMTP is not configured: copy .env.example to .env and fill in "
                  "SMTP_USER and SMTP_PASSWORD.")
        return AlertOutcome(updates, entry("failed", "SMTP is not configured"))

    msg = build_message(due, recipients, config.sender or config.user, resources,
                        dashboard_url, now)
    try:
        sender(msg, config)
    except Exception as exc:  # noqa: BLE001
        err = exc.args[0] if isinstance(exc, SendError) and exc.args else type(exc).__name__
        err = _scrub(str(err), config)
        log.error("Alert email failed: %s", err)
        return AlertOutcome(updates, entry("failed", err))

    log.info("Alert email sent for %d bin(s) to %d recipient(s).", len(due), len(recipients))
    updates.update(mark_sent(states, due, now))
    return AlertOutcome(updates, entry("sent"))


def send_test_email(
    recipients: list[str], config: SmtpConfig, now: float | None = None,
    dry_run: bool = False,
    sender: Callable[[EmailMessage, SmtpConfig], None] = send_message,
) -> dict[str, Any] | None:
    """Send a labelled test message; returns the alertLog entry (None on dry run)."""
    now = time.time() * 1000 if now is None else now
    msg = build_test_message(recipients, config.sender or config.user, now)
    subject = str(msg["Subject"])
    if dry_run:
        print(f"[dry-run] Would send test email to {', '.join(recipients)}: {subject}")
        return None
    if not recipients:
        return build_log_entry("test", "skipped", [], [], subject, now, "No recipients configured")
    if not config.configured:
        log.error("SMTP is not configured: copy .env.example to .env and fill in "
                  "SMTP_USER and SMTP_PASSWORD.")
        return build_log_entry("test", "failed", [], recipients, subject, now, "SMTP is not configured")
    try:
        sender(msg, config)
    except Exception as exc:  # noqa: BLE001
        err = _scrub(str(exc.args[0] if exc.args else type(exc).__name__), config)
        return build_log_entry("test", "failed", [], recipients, subject, now, err)
    return build_log_entry("test", "sent", [], recipients, subject, now)
