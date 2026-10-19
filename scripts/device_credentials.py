"""Reading and writing the device credentials file.

`device-credentials.local` is gitignored, created with mode 600 and never
printed to stdout. It carries a short human-readable header above the JSON, so
the reader skips to the first `{` rather than demanding a pure JSON file.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CREDS_FILE = os.path.join(ROOT, "device-credentials.local")

HEADER = (
    "SmartWaste device credentials (gitignored, mode 600).\n"
    "The password mints refresh tokens; the refresh token is what\n"
    "the firmware should hold. Rotate with --rotate, revoke with --revoke.\n\n"
)


def write(payload):
    """Write the credentials file, readable only by its owner."""
    fd = os.open(CREDS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(HEADER)
        fh.write(json.dumps(payload, indent=2) + "\n")
    os.chmod(CREDS_FILE, 0o600)


def read():
    """Return the stored credentials, or None when there are none."""
    if not os.path.exists(CREDS_FILE):
        return None
    try:
        with open(CREDS_FILE, encoding="utf-8") as fh:
            text = fh.read()
    except OSError:
        return None
    start = text.find("{")
    if start == -1:
        return None
    try:
        return json.loads(text[start:])
    except ValueError:
        return None
