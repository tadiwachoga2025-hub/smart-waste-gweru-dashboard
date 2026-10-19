# Smart Waste Engine — Production Deployment

## What runs where

| Piece | Host | Notes |
|---|---|---|
| Dashboard (React + Vite PWA) | Vercel → https://smart-waste-dashboard-rust.vercel.app | Static build, `npm run build` |
| Logistics engine / model | One long-running process | **Single writer.** Never run two copies |
| Data | Firebase Realtime Database | `/bins`, `/publicBins`, `/logistics`, `/engineStatus`, `/engineLog` |

The engine is `engine.py --watch 300`: it trains the model on the live bin fills,
predicts hours-to-full, optimises the collection route, writes the plan, sends
bin-full email alerts, and processes the dashboard's queued test email. Every
cycle writes a heartbeat (`/engineStatus` and a local `engine_heartbeat.json`).

`engine_service.py` was removed. One supervised loop is easier to reason about
and keeps model persistence, training metrics and alerting in the same code path.

## Option A — GitHub Actions (active, no server, no card)

`.github/workflows/engine.yml` keeps the loop running using the public repo's
free Actions minutes:

- a job holds `python engine.py --watch 300` for 5h50m (under the 6h limit);
- the 5-minute schedule keeps exactly one replacement run queued behind it;
- `workflow_run` hands off immediately when a run completes (backup for a
  delayed or dropped schedule);
- `concurrency: smart-waste-engine` guarantees one writer at a time;
- each cycle is 5 minutes, so a runner hand-off is shorter than one cycle.

To stop the engine deliberately, disable the workflow first, then cancel the
active run: `gh workflow disable engine.yml`.

Setup (already done for this repo on 2026-10-19):

```bash
gh secret set FIREBASE_SERVICE_ACCOUNT < smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json
gh variable set FIREBASE_DB_URL --body "https://smart-waste-gweru-default-rtdb.firebaseio.com/"
gh variable set DASHBOARD_URL --body "https://smart-waste-dashboard-rust.vercel.app"
gh workflow run engine.yml
gh run watch
```

Operate:

```bash
gh run list --workflow engine.yml --limit 5     # recent runs
gh run view <run-id> --log                     # cycle logs
gh run cancel <run-id>                         # stop the active loop
```

Caveats:

- Scheduled workflows on public repos are disabled after **60 days without a
  commit**. Push at least once every two months (or switch to Option B).
- GitHub may delay scheduled starts during high load; the heartbeat in
  `/engineStatus` makes any gap visible in the dashboard.
- The runner filesystem is ephemeral: the model is retrained each cycle and the
  training-history file does not survive a hand-off. Metrics are still written
  to Firebase every cycle.

## Option B — Render worker (always-on, paid plan)

`render.yaml` defines a Docker background worker (`type: worker`), which has no
HTTP port and never spins down. Background workers are a paid plan on Render.

1. Push this repo (already connected to GitHub).
2. Render Dashboard → **New → Blueprint** → select the repo.
3. Set `FIREBASE_CREDENTIALS` (secret, prompted by the blueprint) to the full
   service-account JSON, then apply.
4. Check logs: `render logs -r <service-id>` or the dashboard.

The engine accepts credentials either inline (`FIREBASE_CREDENTIALS` JSON) or as
a mounted file (`FIREBASE_CRED_PATH`). The Docker and systemd options use the
file form.

## Option C — Docker on a VM

```bash
cd smart-waste-dashboard
docker compose up --build -d
docker logs -f smart-waste-engine
```

`docker-compose.yml` mounts the service-account JSON read-only, persists
`/data` (model + history), sets `restart: always`, and uses the local heartbeat
for the healthcheck. The image never contains credentials.

```bash
docker build -t smart-waste-engine:latest .
docker run -d --restart always --name smart-waste-engine \
  -v "$PWD/smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json:/run/secrets/firebase.json:ro" \
  -v smart-waste-data:/data \
  -e POLL_INTERVAL_SEC=300 \
  smart-waste-engine:latest
```

## Option D — systemd on a Linux VM

Copy `smart-waste-engine.service` to `/etc/systemd/system/`, then:

```bash
sudo mkdir -p /etc/smart-waste
sudo install -m 600 smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json \
  /etc/smart-waste/credentials.json
sudo tee /etc/smart-waste/engine.env >/dev/null <<'EOF'
FIREBASE_CRED_PATH=/etc/smart-waste/credentials.json
FIREBASE_DB_URL=https://smart-waste-gweru-default-rtdb.firebaseio.com/
DASHBOARD_URL=https://smart-waste-dashboard-rust.vercel.app
# Optional SMTP fallback (dashboard settings/smtp wins when complete):
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_USER=you@gmail.com
# SMTP_PASSWORD=app-password
EOF

sudo useradd --system --home /opt/smart-waste smartwaste || true
sudo chown -R smartwaste:smartwaste /opt/smart-waste/smart-waste-dashboard
sudo systemctl daemon-reload
sudo systemctl enable --now smart-waste-engine
sudo journalctl -u smart-waste-engine -f
```

`Restart=always`, `RestartSec=10`, `StartLimitIntervalSec=0`, and startup
retries inside `engine.py` mean a cold network or Firebase outage does not leave
the service dead. `SIGTERM` finishes the current step and exits cleanly.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FIREBASE_CREDENTIALS` | empty | Inline service-account JSON (hosts with an env-var secret) |
| `FIREBASE_CRED_PATH` | service-account JSON next to `engine.py` | Credential file (mount; never bake into an image) |
| `FIREBASE_DB_URL` | `https://smart-waste-gweru-default-rtdb.firebaseio.com/` | Realtime DB |
| `POLL_INTERVAL_SEC` | `300` | Seconds between cycles (minimum 30) |
| `LOG_LEVEL` | `INFO` | `DEBUG`/`INFO`/`WARNING`/`ERROR` |
| `ENGINE_DATA_DIR` | app directory | Model, training history and heartbeat |
| `ENGINE_HEARTBEAT_FILE` | `<ENGINE_DATA_DIR>/engine_heartbeat.json` (temp dir by default) | Local liveness file |
| `DASHBOARD_URL` | empty | Link in alert emails |
| `SMTP_HOST` / `PORT` / `USER` / `PASSWORD` / `FROM` / `SECURITY` | empty | Fallback SMTP; dashboard `settings/smtp` wins when complete |
| `ALERT_TO` | empty | Fallback recipients |

The heartbeat is written locally **before** Firebase, so a container or VM can
detect a wedged process even when the network is down.

## Health and monitoring

- Firebase `/engineStatus`: `{at, state, engine, metrics}`; `state` is
  `starting|live|degraded|error|stopped|idle`.
- Firebase `/engineLog`: append-only cycle/training/alert/error trail (shown as
  the External audit log in the dashboard).
- Local heartbeat: `ENGINE_HEARTBEAT_FILE`, refreshed every cycle. Docker and
  the compose healthcheck fail when it is older than 15 minutes.
- `logistics.updatedAt` is the plan age shown on the dashboard.

Quick production check:

```bash
.venv/bin/python - <<'PY'
import time, firebase_admin
from firebase_admin import credentials, db
firebase_admin.initialize_app(
    credentials.Certificate("smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json"),
    {"databaseURL": "https://smart-waste-gweru-default-rtdb.firebaseio.com/"},
)
s = db.reference("engineStatus").get() or {}
print(s.get("state"), "last beat", round((time.time()*1000 - (s.get("at") or 0))/60000, 1), "min ago")
PY
```

## Production hardening checklist

1. **Secrets**: service-account JSON is gitignored, excluded from Docker and
   Vercel uploads, and stored as an encrypted GitHub secret for Option A.
2. **Single writer**: never scale the engine above one replica. The dashboard is
   stateless and can scale behind Vercel.
3. **Rules**: publish `database.rules.json` manually (see `docs/DEPLOY.md`).
4. **Backups**: export Firebase Realtime DB nightly.
5. **Rollback**: redeploy the previous git revision. Docker image tags can be
   pinned (`smart-waste-engine:<tag>`); GitHub Actions re-runs the checked-out
   revision.

## Verification after a deploy

```bash
# Engine heartbeat exists and is fresh (see script above), and:
curl -s -o /dev/null -w "%{http_code}\n" https://smart-waste-dashboard-rust.vercel.app/
gh run list --workflow engine.yml --limit 3
```

A healthy engine shows a `live` heartbeat at most one poll interval old and a
recent `cycle ok` row in `/engineLog`.
