import firebase_admin
from firebase_admin import credentials, db
import xgboost as xgb
import pandas as pd
import numpy as np
import networkx as nx
from scipy.spatial import distance_matrix
import math
import argparse
import logging
import os
import signal
import time
import json
import traceback
from datetime import datetime, timezone

import notifier

ENGINE_VERSION = "2.0.0"
MODEL_FILENAME = "model_xgb.json"
HISTORY_FILENAME = "training_history.json"
HEARTBEAT_FILENAME = "engine_heartbeat.json"
DEFAULT_CRED_FILENAME = "smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json"
DEFAULT_DB_URL = "https://smart-waste-gweru-default-rtdb.firebaseio.com/"
HEARTBEAT_INTERVAL_OK = True  # heartbeat written every cycle

log = logging.getLogger("smartwaste.engine")

# Set by SIGTERM/SIGINT so the watch loop can finish the current step and exit
# cleanly (Docker stop, systemd stop, GitHub Actions cancellation).
_stop = False


def _request_stop(signum, _frame):
    global _stop
    _stop = True
    log.info("Shutdown requested (signal %s); finishing the current step.", signum)


def install_signal_handlers():
    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)


def _stop_reset():
    global _stop
    _stop = False


def _sleep(seconds):
    """Sleep in small slices so a shutdown signal is honoured promptly."""
    deadline = time.time() + max(0, seconds)
    while not _stop and time.time() < deadline:
        time.sleep(min(1.0, max(0.0, deadline - time.time())))


# 1. Initialize Firebase Connection (done in main so `--help` needs no credentials)
def init_firebase():
    if firebase_admin._apps:
        return
    db_url = os.getenv("FIREBASE_DB_URL", DEFAULT_DB_URL)
    inline = os.getenv("FIREBASE_CREDENTIALS") or os.getenv("FIREBASE_CRED_JSON")
    if inline:
        try:
            info = json.loads(inline)
        except ValueError as exc:
            raise RuntimeError("FIREBASE_CREDENTIALS is not valid JSON") from exc
        cred = credentials.Certificate(info)
    else:
        cred_path = os.getenv("FIREBASE_CRED_PATH") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), DEFAULT_CRED_FILENAME)
        cred = credentials.Certificate(cred_path)
    firebase_admin.initialize_app(cred, {'databaseURL': db_url})


def init_firebase_with_retry(max_backoff=60):
    """Startup must survive a cold network, DNS blip or slow secret mount.

    A hosted engine that exits on the first failed connection needs an external
    supervisor; retrying here means the process itself never gives up.
    """
    delay = 2
    while not _stop:
        try:
            init_firebase()
            log.info("Firebase connected: %s", os.getenv("FIREBASE_DB_URL", DEFAULT_DB_URL))
            return True
        except Exception as exc:  # noqa: BLE001 - retried below
            log.error("Firebase init failed: %s: %s (retry in %ss)",
                      type(exc).__name__, exc, delay)
            _sleep(delay)
            delay = min(delay * 2, max_backoff)
    return False


# ---------------------------------------------------------------------------
# Model persistence + continuous training.
# The engine must stay running AND keep learning: every cycle the model is
# re-trained on (synthetic prior + real observations from this cycle), saved
# to disk, and its metrics are pushed to Firebase so the External audit log
# can show training health. A corrupt/missing file never stops the engine —
# it falls back to a fresh synthetic model and logs the event.
# ---------------------------------------------------------------------------
def _base_dir():
    return os.path.dirname(os.path.abspath(__file__))


def _data_dir():
    """Writable directory for the model, training history and heartbeat.

    Defaults to the app directory for local runs; containers set
    ENGINE_DATA_DIR=/data so a mounted volume keeps state across restarts.
    """
    path = os.getenv("ENGINE_DATA_DIR") or _base_dir()
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        pass
    return path


def _model_path():
    return os.path.join(_data_dir(), MODEL_FILENAME)


def _history_path():
    return os.path.join(_data_dir(), HISTORY_FILENAME)


def _heartbeat_path():
    return os.getenv("ENGINE_HEARTBEAT_FILE") or os.path.join(
        _data_dir(), HEARTBEAT_FILENAME)


def _utc_ms():
    return int(time.time() * 1000)


def load_training_history():
    try:
        with open(_history_path(), encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def append_training_history(entry, cap=500):
    history = load_training_history()
    history.append(entry)
    history = history[-cap:]
    try:
        with open(_history_path(), "w", encoding="utf-8") as fh:
            json.dump(history, fh)
    except OSError as exc:
        log.warning("Could not persist training history: %s", exc)
    return history


def synthetic_prior(n=200, seed=42):
    rng = np.random.default_rng(seed)
    current = rng.integers(20, 90, n).astype(float)
    rate = rng.uniform(5.0, 15.0, n)
    target = ((90 - current) / np.maximum(rate, 0.5)) * 24
    return pd.DataFrame({'current_fill': current, 'historical_daily_rate': rate}), target


def real_samples_from_bins(bins_data, default_rate=8.0):
    """Turn this cycle's live fills into training rows so the model learns
    the campus it actually serves. Rows are (fill, rate) -> hours-to-full."""
    fills, rates = [], []
    for b_data in (bins_data or {}).values():
        if not isinstance(b_data, dict):
            continue
        try:
            fill = float(b_data.get('fillLevel', ''))
        except (TypeError, ValueError):
            continue
        if not math.isfinite(fill) or not 0 <= fill <= 100:
            continue
        fills.append(fill)
        rates.append(default_rate)
    if not fills:
        return None, None
    X = pd.DataFrame({'current_fill': fills, 'historical_daily_rate': rates})
    y = ((90 - X['current_fill'].clip(upper=90)) / X['historical_daily_rate']) * 24
    return X, y


def _fit_with_metrics(X, y):
    # 80/20 split for an honest error estimate; tiny sets skip the split.
    n = len(X)
    if n >= 20:
        idx = np.random.RandomState(7).permutation(n)
        cut = max(1, int(n * 0.8))
        tr, te = idx[:cut], idx[cut:]
        model = xgb.XGBRegressor(objective='reg:squarederror', n_estimators=80,
                                 max_depth=3, learning_rate=0.08, subsample=0.9,
                                 random_state=42, n_jobs=1)
        model.fit(X.iloc[tr], y.iloc[tr] if hasattr(y, 'iloc') else y[tr])
        pred = model.predict(X.iloc[te])
        actual = (y.iloc[te].to_numpy() if hasattr(y, 'iloc') else np.asarray(y)[te])
        rmse = float(np.sqrt(np.mean((pred - actual) ** 2)))
    else:
        model = xgb.XGBRegressor(objective='reg:squarederror', n_estimators=50,
                                 max_depth=3, random_state=42, n_jobs=1)
        model.fit(X, y)
        rmse = 0.0
    return model, rmse


def train_forecasting_model(extra_X=None, extra_y=None):
    """Trains an XGBoost model to predict hours until full based on historical fill rates.

    Kept backward-compatible (returns just the model). The metrics-persisting
    variant below is what the engine loop uses so training stays observable.
    """
    model, _ = train_model_with_metrics(extra_X, extra_y)
    return model


def train_model_with_metrics(extra_X=None, extra_y=None):
    X_syn, y_syn = synthetic_prior()
    frames, targets = [X_syn], [pd.Series(y_syn)]
    if extra_X is not None and extra_y is not None and len(extra_X) > 0:
        frames.append(extra_X)
        targets.append(extra_y if isinstance(extra_y, pd.Series) else pd.Series(np.asarray(extra_y).ravel()))
    X_all = pd.concat(frames, ignore_index=True)
    y_all = pd.concat(targets, ignore_index=True)

    # Try to warm-start from the persisted model file; fall back cleanly.
    model = None
    resumed = False
    try:
        if os.path.exists(_model_path()):
            booster = xgb.Booster()
            booster.load_model(_model_path())
            resumed = True
    except Exception as exc:  # noqa: BLE001 - corrupt file must not stop training
        log.warning("Persisted model unreadable, retraining from scratch: %s", exc)

    model, rmse = _fit_with_metrics(X_all, y_all)

    metrics = {
        'samples': int(len(X_all)),
        'realSamples': int(len(extra_X)) if extra_X is not None else 0,
        'rmseHours': round(rmse, 2),
        'resumed': resumed,
        'version': ENGINE_VERSION,
    }
    try:
        model.save_model(_model_path())
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not persist model file: %s", exc)
        metrics['persisted'] = False
    else:
        metrics['persisted'] = True
    append_training_history({'at': _utc_ms(), **metrics})
    return model, metrics


# ---------------------------------------------------------------------------
# Observability: every cycle writes a heartbeat (/engineStatus) and an
# append-only trail (/engineLog). Together with /alertLog these form the
# EXTERNAL audit log in the dashboard. Writes never raise: a logging failure
# must never break a collection cycle.
# ---------------------------------------------------------------------------
def write_engine_log(kind, status, detail="", metrics=None):
    entry = {
        'at': _utc_ms(),
        'kind': kind,          # cycle | training | alert | error | heartbeat | lifecycle
        'status': status,      # ok | warning | failed | info
        'detail': (detail or "")[:500],
        'engine': ENGINE_VERSION,
    }
    if metrics:
        entry['metrics'] = metrics
    try:
        db.reference('engineLog').push(entry)
    except Exception as exc:  # noqa: BLE001
        log.warning("engineLog write failed: %s", exc)
    return entry


def write_heartbeat(state, metrics=None):
    payload = {'at': _utc_ms(), 'state': state, 'engine': ENGINE_VERSION}
    if metrics:
        payload['metrics'] = metrics
    # Local heartbeat first: container healthchecks can then detect a wedged
    # process even while Firebase is briefly unreachable.
    try:
        path = _heartbeat_path()
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh)
        os.replace(tmp, path)
    except OSError as exc:
        log.warning("local heartbeat write failed: %s", exc)
    try:
        db.reference('engineStatus').set(payload)
    except Exception as exc:  # noqa: BLE001
        log.warning("heartbeat write failed: %s", exc)

def optimize_route(critical_bins):
    """Calculates the shortest driving path connecting all critical bins."""
    if len(critical_bins) < 2:
        return [bin_data['id'] for bin_data in critical_bins]

    # Extract coordinates
    coords = [[b['lat'], b['lng']] for b in critical_bins]
    
    # Create a distance matrix and solve as a TSP (Traveling Salesperson Problem)
    dist_matrix = distance_matrix(coords, coords)
    G = nx.from_numpy_array(dist_matrix)
    tsp_path = nx.approximation.traveling_salesman_problem(G, cycle=False)
    
    # Return the ordered list of bin IDs based on the optimized route
    return [critical_bins[i]['id'] for i in tsp_path]

def effective_smtp_config(smtp_settings_raw=None, env=None):
    """Precedence: Firebase `settings/smtp` wins when complete, else `.env`.

    "Complete" means user + password are both present (``configured``).
    Never logs the password: only the scrubbed repr (``***``) ever leaves
    here, via :func:`notifier._scrub` discipline in the send path.
    """
    try:
        from_settings = notifier.smtp_config_from_settings(smtp_settings_raw)
        if from_settings.configured:
            return from_settings
    except Exception as exc:  # noqa: BLE001 - malformed settings fall back to .env
        log.warning("Could not parse settings/smtp, falling back to .env: %s",
                    type(exc).__name__)
    return notifier.smtp_config_from_env(env)


def current_effective_smtp_config():
    """Read `settings/smtp` from Firebase and resolve the effective config."""
    try:
        raw = db.reference('settings/smtp').get()
    except Exception as exc:  # noqa: BLE001 - a read failure falls back to .env
        log.warning("Could not read settings/smtp: %s", type(exc).__name__)
        raw = None
    return effective_smtp_config(raw)


def handle_smtp_test_queue(dry_run=False):
    """Handle one pending `settings/smtpTest` request, if any. Never raises.

    The dashboard writes ``status: 'pending'``; the engine sends a test email
    via :func:`notifier.send_test_email` to the current normalized recipients,
    pushes the resulting entry to ``alertLog`` (type ``'test'``), and acks the
    node to ``sent``/``failed`` with ``handledAt`` + ``result`` (<=500 chars,
    scrubbed so the officer-readable node never carries the password).
    Only runs as part of a cycle; failures never break the cycle.
    """
    try:
        test_node = db.reference('settings/smtpTest').get() or {}
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not read settings/smtpTest: %s", type(exc).__name__)
        return
    if not isinstance(test_node, dict) or test_node.get('status') != 'pending':
        return
    try:
        try:
            alert_settings = notifier.normalize_settings(
                db.reference('settings/alerts').get())
        except Exception:  # noqa: BLE001
            alert_settings = notifier.normalize_settings(None)
        recipients = alert_settings['recipients']
        config = current_effective_smtp_config()
        if dry_run:
            print(f"[dry-run] Would send queued test email to "
                  f"{', '.join(recipients) or '(no recipients)'}")
            return
        entry = notifier.send_test_email(recipients, config)
        if entry is None:
            return
        try:
            db.reference('alertLog').push(entry)
        except Exception as exc:  # noqa: BLE001
            log.warning("alertLog write for test email failed: %s", type(exc).__name__)
        status = 'sent' if entry.get('status') == 'sent' else 'failed'
        if status == 'sent':
            result = f"Test email sent to {len(recipients)} recipient(s)."
        else:
            result = str(entry.get('error') or entry.get('status') or 'failed')
        # Scrub + cap: smtpTest is officer-readable, so the password must
        # never appear here even if an SMTP library echoes credentials.
        result = notifier._scrub(result, config)[:500]
        try:
            db.reference('settings/smtpTest').update({
                'status': status,
                'handledAt': _utc_ms(),
                'result': result,
            })
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not ack settings/smtpTest: %s", type(exc).__name__)
        log.info("Queued test email %s.", status)
    except Exception as exc:  # noqa: BLE001 - the queue never breaks the cycle
        log.warning("Test-email queue handling failed: %s", type(exc).__name__)

def send_bin_alerts(bins_data, resources, dry_run=False):
    """Email the operators about newly-full bins and persist alert state/log."""
    outcome = notifier.process_alerts(
        bins_data,
        db.reference('alertState').get() or {},
        db.reference('settings/alerts').get(),
        current_effective_smtp_config(),
        resources=resources,
        dashboard_url=os.environ.get('DASHBOARD_URL', ''),
        dry_run=dry_run,
    )
    if dry_run:
        return
    for bin_id, state in outcome.state_updates.items():
        db.reference('alertState').child(bin_id).update(state)
    if outcome.log_entry:
        db.reference('alertLog').push(outcome.log_entry)

def run_test_email(dry_run=False):
    """Send a labelled test message to the configured recipients, then log it."""
    settings = notifier.normalize_settings(db.reference('settings/alerts').get())
    entry = notifier.send_test_email(settings['recipients'], current_effective_smtp_config(),
                                     dry_run=dry_run)
    if entry is None:
        return
    print(f"Test email {entry['status']}" + (f": {entry['error']}" if entry.get('error') else "."))
    db.reference('alertLog').push(entry)

def run_logistics_engine(dry_run=False):
    cycle_started = time.time()
    log.info("Fetching live sensor data from Firebase...")
    bins_ref = db.reference('bins')
    try:
        bins_data = bins_ref.get()
    except Exception as exc:
        log.error("Could not read /bins: %s: %s", type(exc).__name__, exc)
        write_engine_log('cycle', 'failed', f"Could not read bins: {type(exc).__name__}")
        write_heartbeat('error', {'error': 'bins-read-failed'})
        return {'ok': False, 'error': 'bins-read-failed'}

    if not bins_data:
        log.info("No bins found in database.")
        write_engine_log('cycle', 'info', "No bins in database; nothing to predict.",
                         {'binsSeen': 0})
        write_heartbeat('idle', {'binsSeen': 0})
        return {'ok': True, 'binsSeen': 0}

    public_bins_ref = db.reference('publicBins')

    # 0. Continuous training: learn from this cycle's real fills on top of the
    #    synthetic prior, persist the model, and record metrics for the audit log.
    try:
        real_X, real_y = real_samples_from_bins(bins_data)
        model, train_metrics = train_model_with_metrics(real_X, real_y)
        write_engine_log('training', 'ok',
                         f"Trained on {train_metrics['samples']} samples "
                         f"({train_metrics['realSamples']} live, RMSE {train_metrics['rmseHours']}h).",
                         train_metrics)
    except Exception as exc:  # noqa: BLE001 - training must never stop collection
        log.error("Training failed, using synthetic fallback: %s", exc)
        write_engine_log('training', 'failed', f"Training failed: {type(exc).__name__}",
                         {'error': traceback.format_exc(limit=3)[-400:]})
        model = train_forecasting_model()
        train_metrics = {'samples': 0, 'realSamples': 0, 'rmseHours': -1,
                         'fallback': True}

    critical_bins = []
    skipped = 0

    for bin_id, b_data in bins_data.items():
        if not isinstance(b_data, dict):
            skipped += 1
            continue
        try:
            current_fill = float(b_data.get('fillLevel', 0))
        except (TypeError, ValueError):
            skipped += 1
            continue
        if not math.isfinite(current_fill):
            skipped += 1
            continue

        # 1. Predictive Analytics: Forecast when bin will be full
        try:
            X_pred = pd.DataFrame({'current_fill': [current_fill], 'historical_daily_rate': [8.0]})
            hours_until_full = float(model.predict(X_pred)[0])
            if not math.isfinite(hours_until_full):
                raise ValueError("non-finite prediction")
        except Exception as exc:  # noqa: BLE001 - one bad row never stops the cycle
            log.warning("Prediction failed for %s: %s", bin_id, exc)
            hours_until_full = max(0.0, (90 - min(current_fill, 90)) / 8.0 * 24)
            skipped += 1

        predicted_status = "Critical Now" if current_fill >= 90 else f"Full in {max(1, int(hours_until_full))} hours"
        b_data['prediction'] = predicted_status  # used by the alert email

        # Update specific bin with its prediction
        try:
            bins_ref.child(bin_id).update({'prediction': predicted_status})
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not write prediction for %s: %s", bin_id, exc)

        # Citizen-safe mirror: location and a coarse fill band only. Residents
        # may read /publicBins but never /bins (predictions, sensor internals).
        fill_band = 'critical' if current_fill >= 90 else 'high' if current_fill >= 75 else 'normal'
        try:
            public_bins_ref.child(bin_id).set({
                'location': b_data.get('location', bin_id),
                'lat': b_data.get('lat'),
                'lng': b_data.get('lng'),
                'band': fill_band,
            })
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not mirror public bin %s: %s", bin_id, exc)

        # Flag for collection if it's > 80% or will be full in < 12 hours
        if current_fill >= 80 or hours_until_full < 12:
            b_data['id'] = bin_id
            critical_bins.append(b_data)

    # 2. Automation: Optimize Collection Route
    log.info("Identified %d bins requiring collection.", len(critical_bins))
    try:
        route_order = optimize_route(critical_bins)
    except Exception as exc:  # noqa: BLE001
        log.error("Route optimisation failed: %s", exc)
        route_order = [b['id'] for b in critical_bins]
        write_engine_log('cycle', 'warning', f"Route fallback (unoptimised): {type(exc).__name__}")

    # Build the sequence of GPS coordinates for the dashboard map
    route_coords = []
    for bid in route_order:
        row = bins_data.get(bid, {})
        try:
            route_coords.append([float(row['lat']), float(row['lng'])])
        except (TypeError, ValueError, KeyError):
            log.warning("Skipping bin %s with bad coordinates in route.", bid)

    # 3. Resource Requirements Allocation
    # Estimate total distance (rough estimation connecting coordinates)
    total_distance_km = 0
    for i in range(len(route_coords)-1):
        try:
            total_distance_km += math.dist(route_coords[i], route_coords[i+1]) * 111 # rough lat/lng to km conversion
        except (TypeError, ValueError):
            continue

    trucks_required = 0 if not critical_bins else max(1, math.ceil(len(critical_bins) / 10)) # Assuming 1 truck per 10 bins
    fuel_estimate = round(total_distance_km * 0.5, 2) # 0.5 Liters per KM estimate

    logistics_payload = {
        'activeRoute': route_coords,
        'updatedAt': _utc_ms(),  # plan age; the dashboard shows "planned X ago"
        'resources': {
            'trucksAllocated': trucks_required,
            'routeDistanceKm': round(total_distance_km, 2),
            'estimatedFuelLiters': fuel_estimate,
            'binsToCollect': len(critical_bins)
        }
    }

    # Push logistics plan to Firebase
    try:
        db.reference('logistics').set(logistics_payload)
    except Exception as exc:  # noqa: BLE001
        log.error("Could not write /logistics: %s", exc)
        write_engine_log('cycle', 'failed', f"Could not write logistics: {type(exc).__name__}")
        write_heartbeat('error', {'error': 'logistics-write-failed'})
        return {'ok': False, 'error': 'logistics-write-failed'}
    log.info("✓ Predictive analytics and routing complete. Dashboard updated.")

    # 4. Notify: email operators about newly-full bins (never breaks the run)
    alert_status = 'none'
    try:
        send_bin_alerts(bins_data, logistics_payload['resources'], dry_run)
        alert_status = 'sent-or-none-due'
    except Exception as exc:
        alert_status = f"failed: {type(exc).__name__}"
        log.error("Alert step failed: %s: %s", type(exc).__name__, exc)

    # 5. Queued test email from the dashboard (settings/smtpTest == pending).
    #    Handled every cycle and only here; never breaks the run.
    try:
        handle_smtp_test_queue(dry_run)
    except Exception as exc:  # noqa: BLE001 - belt and braces; handler already swallows
        log.warning("Test-email queue step failed: %s", type(exc).__name__)

    duration_s = round(time.time() - cycle_started, 2)
    cycle_metrics = {
        'binsSeen': len(bins_data),
        'criticalBins': len(critical_bins),
        'skippedRows': skipped,
        'trucks': trucks_required,
        'distanceKm': round(total_distance_km, 2),
        'durationS': duration_s,
        'alerts': alert_status,
        'training': train_metrics,
    }
    write_engine_log('cycle', 'ok' if skipped == 0 else 'warning',
                     f"Cycle complete in {duration_s}s: {len(bins_data)} bins, "
                     f"{len(critical_bins)} critical, {trucks_required} truck(s).",
                     cycle_metrics)
    write_heartbeat('live', cycle_metrics)
    return {'ok': True, **cycle_metrics}

def watch_seconds(value):
    seconds = int(value)
    if seconds < 30:
        raise argparse.ArgumentTypeError("--watch must be at least 30 seconds")
    return seconds

def main():
    parser = argparse.ArgumentParser(description="Smart Waste logistics engine with email alerts.")
    parser.add_argument('--dry-run', action='store_true',
                        help="do everything except send email or write alert state; print what would be sent")
    parser.add_argument('--test-email', action='store_true',
                        help="send a test email to the configured recipients, then exit")
    parser.add_argument('--watch', type=watch_seconds, metavar='SECONDS',
                        help="rerun the engine every SECONDS (minimum 30)")
    parser.add_argument('--once', action='store_true',
                        help="run a single cycle and exit with non-zero status on failure (for cron/systemd)")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    notifier.load_env_file(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

    if args.test_email:
        init_firebase()
        run_test_email(args.dry_run)
        return
    if args.once:
        init_firebase()
        result = run_logistics_engine(args.dry_run)
        raise SystemExit(0 if result and result.get('ok') else 1)
    if not args.watch:
        init_firebase()
        run_logistics_engine(args.dry_run)
        return

    # Supervised watch loop: the process stays up for the lifetime of the host.
    # Startup retries forever (cold network, mounted secret, DNS blip) and a
    # failed cycle backs off (30s -> 60s -> ... capped at 5 min) but never
    # exits; every failure is recorded in /engineLog so the External audit log
    # shows gaps honestly.
    install_signal_handlers()
    print(f"Watching: running every {args.watch}s (engine v{ENGINE_VERSION}). "
          "Send SIGTERM or press Ctrl-C to stop.")
    log.info("Data directory: %s | heartbeat: %s", _data_dir(), _heartbeat_path())

    if not init_firebase_with_retry():
        log.info("Stopped before Firebase connected.")
        return
    write_engine_log('lifecycle', 'info',
                     f"Engine started (v{ENGINE_VERSION}), cycle every {args.watch}s.")
    write_heartbeat('starting')
    consecutive_failures = 0
    while not _stop:
        try:
            result = run_logistics_engine(args.dry_run)
            if _stop:
                break
            if result and result.get('ok'):
                consecutive_failures = 0
                _sleep(args.watch)
            else:
                raise RuntimeError((result or {}).get('error', 'cycle-failed'))
        except Exception as exc:
            if _stop:
                break
            consecutive_failures += 1
            backoff = min(args.watch * (2 ** min(consecutive_failures - 1, 3)), 300)
            log.error("Engine cycle #%d failed: %s: %s (retry in %ss)",
                      consecutive_failures, type(exc).__name__, exc, backoff)
            try:
                write_engine_log('error', 'failed',
                                 f"Cycle failed ({type(exc).__name__}); retry in {backoff}s.",
                                 {'failures': consecutive_failures})
                write_heartbeat('degraded', {'failures': consecutive_failures})
            except Exception:
                pass
            _sleep(backoff)

    log.info("Engine stopped.")
    try:
        write_engine_log('lifecycle', 'info', "Engine stopped.")
        write_heartbeat('stopped')
    except Exception:
        pass

if __name__ == "__main__":
    main()