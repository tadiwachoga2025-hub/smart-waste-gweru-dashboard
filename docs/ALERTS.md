# Bin-full email alerts (SMTP)

When a bin reaches the critical level, the Python engine emails the people who run the system. One email per run lists every bin that has just become full.

```
ESP32 sensors → Firebase bins/{id}.fillLevel
                      │
      engine.py (reads bins, predicts, plans the route)
                      │  fillLevel ≥ criticalAt, and not already alerted
                      ▼
      notifier.py → SMTP (Gmail) → recipients
                      │
      Firebase alertLog/{id}  ← the Alerts screen shows this history
```

## How an alert is decided

An alert is sent for a bin when **all** of these hold:

1. Alerts are switched on (`settings/alerts.enabled`, on by default).
2. The bin's fill level is at or above `criticalAt` (default **90%**).
3. The bin has not already been alerted. After a successful email the bin is "disarmed" and stays quiet, even if it remains full.
4. At least `minIntervalMinutes` (default **30**) have passed since that bin's last alert.

A bin re-arms once its level drops below `rearmBelow` (default **75%**), i.e. after it has been emptied. If sending fails, the bin is **not** disarmed, so the next engine run tries again.

Settings live in Firebase at `settings/alerts` and are edited by an administrator on the **Alerts** screen. Recipients default to your own address; if the list is empty the engine falls back to `ALERT_TO` in `.env`.

## SMTP server configuration (`settings/smtp`)

The SMTP connection is manageable from the dashboard and stored in Firebase at `settings/smtp`. The engine reads it with the Admin SDK every cycle.

| Field | Type / limits | Notes |
|---|---|---|
| `host` | string ≤ 253 | e.g. `smtp.gmail.com` |
| `port` | number 1–65535 | 587 for `starttls`, 465 for `ssl` |
| `sender` | string ≤ 254 | Shown as From; defaults to `user` when empty |
| `security` | `starttls` \| `ssl` \| `none` | |
| `user` | string ≤ 254 | SMTP login (the sending address) |
| `password` | string ≤ 500, admin-only | App password; never rendered back (masked after save) |
| `passwordSet` | boolean | `true` once a password has been saved; lets the dashboard show "saved" without reading the secret |
| `updatedAt` | number | Last dashboard save (ms) |

`settings/smtp` is **admin-only read and write**.

### Precedence: Firebase > `.env`

The effective config is `settings/smtp` **when complete** (both `user` and `password` present), otherwise the `.env` fallback (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURITY` via the existing `smtp_config_from_env`). This applies to bin-full emails, the queued test email, and `engine.py --test-email`. Configure the dashboard node once; keep `.env` as the fallback for local runs.

### Test-email queue (`settings/smtpTest`)

The **Send test email** button writes:

```
settings/smtpTest = { requestedAt, requestedByUid, requestedByName,
                      status: 'pending' }
```

Each engine cycle — and only there, to stay simple — checks the node. When `status == 'pending'` the engine sends a labelled test message via `notifier.send_test_email` to the **current normalized recipients** (from `settings/alerts`), pushes the entry to `alertLog` (type `'test'`), and acks the queue node to `'sent'`/`'failed'` with `handledAt` + `result` (≤ 500 chars). A skipped send (no recipients, SMTP unconfigured) is acked as `failed` with the reason in `result`. Queue failures are caught and never break the cycle; `dry-run` prints what would be sent and writes nothing.

### Who can see what

- `settings/smtp`: **admin-only read and write**. Officers see a locked "Administrator only" panel; they cannot read `host`, `user` or any other child either.
- `settings/smtpTest`: readable by administrators and officers; admin-write only. Officers can follow the `pending → sent/failed` state and the `result` message.

### Password handling

- `settings/smtp` is admin-only at the node level. Note that Firebase rules cascade: a `.read` grant on a parent covers its whole subtree, so a narrower `password` child rule can never restrict a role that can already read the parent. The earlier "officers may read the connection fields except the password" arrangement was unsound for that reason; admin-only read on the whole node is the fix.
- The dashboard writes `passwordSet: true` when a password is saved. On first setup **Save refuses without the app password**; afterwards leaving the field empty keeps the current password, and the password itself is never rendered back (the UI shows a saved/masked placeholder).
- The engine never logs the password: `SmtpConfig.__repr__` renders `***`, send failures are scrubbed with `notifier._scrub`, and the queued-test `result` is scrubbed and capped at 500 chars before it lands on the officer-readable `smtpTest` node or in `alertLog`.
- `.env` remains gitignored and is only the fallback; never paste the app password into chat, code, or a commit.

## One-time setup (about 5 minutes)

Gmail will not accept your normal password for SMTP. You need an **app password**:

1. Sign in to the Google account that will **send** the emails (this can be the same account that receives them).
2. Turn on **2-Step Verification**: https://myaccount.google.com/security
3. Create an app password: https://myaccount.google.com/apppasswords. Name it `SmartWaste`. Google shows a 16-character password once. Copy it.
4. Save it in the dashboard: sign in as an administrator, open **Alerts → SMTP configuration**, and enter host `smtp.gmail.com`, port `587`, the sender address, the Gmail user and the 16-character app password. Save once with the password; later saves can leave it empty to keep it. The password is stored at `settings/smtp` (admin-only) and is never shown back.
   For a local engine run you can use `.env` instead: `cp .env.example .env`, then fill in `SMTP_USER` (the sending Gmail address) and `SMTP_PASSWORD` (the app password, spaces optional). `.env` is gitignored: it never leaves your machine. **Never paste the app password into chat, code or a commit.**
5. Send a test email — from the dashboard (**Send test email**, handled by the engine queue above), or from the machine that runs the engine:
   ```bash
   .venv/bin/python engine.py --test-email
   ```
   Check the inbox (and spam). The test also appears in the Alerts screen history.

## Running it

| Command | What it does |
|---|---|
| `.venv/bin/python engine.py` | One run: predictions, route, and any due alerts |
| `.venv/bin/python engine.py --watch 60` | Repeat every 60 seconds (minimum 30). Leave it running |
| `.venv/bin/python engine.py --dry-run` | Show what would be emailed, send nothing, change nothing |
| `.venv/bin/python engine.py --test-email` | Send a labelled test message and exit |

## Demoing it

The engine must be **running** for the queued test email and bin-full alerts to move: the test queue is processed once per cycle, so either leave `.venv/bin/python engine.py --watch 60` running or run it once after each change.

1. In the Firebase console, open Realtime Database → `bins` → any bin, and set `fillLevel` to `95`.
2. Run `.venv/bin/python engine.py` (or let the `--watch` loop reach its next cycle).
3. The email arrives, and the Alerts screen shows a "Bin full" row with status **Sent**.
4. To demo again, set that bin below 75, run the engine once (it re-arms), then raise it to 95 again.

## If nothing arrives

- The Alerts screen shows a red notice and the error when the last attempt failed. `SMTP is not configured` means neither `settings/smtp` (user + password) nor `.env` is complete. Fix it in the dashboard first: **Alerts → SMTP configuration** (admin only — host, port, sender, user and the Gmail app password). If you are running the engine locally and prefer `.env`, provide `SMTP_USER` and `SMTP_PASSWORD` there instead. The dashboard node wins when complete.
- `Username and Password not accepted` means you used your normal password instead of an app password, or 2-Step Verification is off.
- Check spam. The first message from a new sender often lands there.
- Run `--dry-run` to confirm the engine finds a due bin and a recipient.

## Limits

- The engine only runs when you run it. For continuous alerts leave `--watch` running on a computer or server that stays on. In production it runs via `.github/workflows/engine.yml`; see `DEPLOYMENT.md` for the hosted alternatives.
- Gmail's free SMTP allows roughly 500 messages a day, far more than this system sends, because it sends one email per run and one alert per bin per fill cycle.
- The alert history (`alertLog`) is written by the engine, so it shows what the engine attempted, not what the mail provider delivered.
