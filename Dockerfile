# Smart Waste Logistics Engine - production image
# The engine is a single-writer background process: run exactly one replica.
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POLL_INTERVAL_SEC=300 \
    LOG_LEVEL=INFO \
    ENGINE_DATA_DIR=/data \
    ENGINE_HEARTBEAT_FILE=/data/engine_heartbeat.json \
    FIREBASE_CRED_PATH=/run/secrets/firebase.json \
    FIREBASE_DB_URL=https://smart-waste-gweru-default-rtdb.firebaseio.com/

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /data \
    && chown appuser:appuser /data

COPY --chown=appuser:appuser engine.py notifier.py ./

USER appuser

# A cycle writes /data/engine_heartbeat.json. Fail the healthcheck when the
# engine has not completed a cycle in 15 minutes (3 x the default poll).
HEALTHCHECK --interval=60s --timeout=10s --start-period=90s --retries=3 \
    CMD python -c "import os,sys,time; p=os.environ['ENGINE_HEARTBEAT_FILE']; sys.exit(0 if os.path.exists(p) and time.time()-os.path.getmtime(p) < 900 else 1)"

CMD ["sh", "-c", "exec python -u engine.py --watch ${POLL_INTERVAL_SEC:-300}"]
