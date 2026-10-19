"""Shared public Firebase settings for the Python tooling.

Reads `firebase-config.json` at the repo root — the same file the dashboard
imports — so the browser and the scripts can never disagree about the project,
the API key or the database URL. Nothing secret lives here: a Firebase web
config is public by design, and the Realtime Database rules are what actually
protect the data.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CONFIG_PATH = os.path.join(ROOT, "firebase-config.json")


def load_config():
    with open(CONFIG_PATH, encoding="utf-8") as fh:
        return json.load(fh)


CONFIG = load_config()
API_KEY = CONFIG["apiKey"]
PROJECT_ID = CONFIG["projectId"]
DB_URL = CONFIG["databaseURL"].rstrip("/")
DB_ROOT = f"{DB_URL}/"

# The default gateway identity for the ESP32 fleet. One shared account keeps
# the rules simple; give each physical device its own account if you need
# per-device revocation.
DEFAULT_DEVICE_EMAIL = "smart-waste-device@gweru.local"
DEFAULT_DEVICE_NAME = "SmartWaste device gateway"


def service_account_key():
    """Path to the Admin SDK service-account key, or None when it is absent."""
    candidate = os.path.join(ROOT, "smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json")
    return candidate if os.path.exists(candidate) else None
