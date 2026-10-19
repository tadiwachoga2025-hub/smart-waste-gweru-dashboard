"""Publish `database.rules.json` to the live Realtime Database.

    .venv/bin/python scripts/publish_rules.py --check   # preflight only
    .venv/bin/python scripts/publish_rules.py            # publish, then verify

The Realtime Database rules are the security boundary of this project: they
decide who may read a resident's complaint, who may write a reading, and
which fields a device is allowed to touch. The rules in this repo are the
source of truth, and this script is the only supported way to put them live.

Permissions
-----------
Publishing needs the service account to hold the **Firebase Realtime Database
Admin** role (`roles/firebasedatabase.admin`). Without it the database answers
`403 Permission denied` for the rules endpoint, while ordinary reads and
writes still work — which is why this failure is easy to miss. Grant the role
in the Firebase console: Project settings -> Service accounts -> the
`firebase-adminsdk-fbsvc` account -> Add role -> Firebase Realtime Database
Admin.

The script never leaves the rules half-applied: it writes the previous
published rules to `database.rules.published.bak.json` first, so a bad
publish can be rolled back with `--restore`.
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

import google.auth
import google.auth.transport.requests
from google.oauth2 import service_account

from firebase_project import DB_URL, service_account_key

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RULES_FILE = os.path.join(ROOT, "database.rules.json")
BACKUP_FILE = os.path.join(ROOT, "database.rules.published.bak.json")
RULES_URL = f"{DB_URL}/.settings/rules.json"
# The Realtime Database rules endpoint rejects a token that does not carry
# userinfo.email as well, even when firebase.database is present.
SCOPES = ["https://www.googleapis.com/auth/firebase.database",
          "https://www.googleapis.com/auth/userinfo.email"]


def access_token():
    key = service_account_key()
    if not key:
        sys.exit("Service-account key not found next to engine.py.")
    creds = service_account.Credentials.from_service_account_file(key, scopes=SCOPES)
    creds.refresh(google.auth.transport.requests.Request())
    return creds.token


def call(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace")


def explain(status, body):
    if status == 200:
        return "ok"
    if status == 401:
        return ("the service-account token was rejected (401). The key may be "
                "revoked, or the service account may not exist any more.")
    if status == 403:
        return ("the rules endpoint rejected the token (403). The service account "
                "needs the Firebase Realtime Database Admin role "
                "(roles/firebasedatabase.admin), and the OAuth token must be in "
                "?access_token=, not an Authorization header.")
    if status == 400:
        return f"the rules did not compile (400): {body[:200]}"
    return f"unexpected response {status}: {body[:200]}"


def published_rules(token):
    status, body = call("GET", f"{RULES_URL}?access_token={urllib.parse.quote(token)}")
    return status, body


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true", help="report whether publishing is possible")
    ap.add_argument("--restore", action="store_true", help="re-publish the backed-up rules")
    args = ap.parse_args()

    token = access_token()
    status, body = published_rules(token)
    print(f"Reading the published rules: HTTP {status}")

    if status != 200:
        print(explain(status, body))
        if args.check:
            sys.exit(1)
        sys.exit("Cannot publish: fix the permission problem above first.")

    current = json.loads(body)
    print(f"Currently published rules: {len(json.dumps(current))} bytes")

    if args.restore:
        if not os.path.exists(BACKUP_FILE):
            sys.exit(f"No backup at {BACKUP_FILE} to restore.")
        with open(BACKUP_FILE, encoding="utf-8") as fh:
            payload = json.load(fh)
        status, body = call("PUT", f"{RULES_URL}?access_token={urllib.parse.quote(token)}", payload)
        print(f"Restore: HTTP {status} {explain(status, body)}")
        sys.exit(0 if status == 200 else 1)

    with open(RULES_FILE, encoding="utf-8") as fh:
        payload = json.load(fh)

    if args.check:
        same = payload == current
        print("Repository rules and published rules are identical."
              if same else "Repository rules differ from the published rules.")
        print("Run without --check to publish.")
        return

    with open(BACKUP_FILE, "w", encoding="utf-8") as fh:
        json.dump(current, fh, indent=2)
    os.chmod(BACKUP_FILE, 0o600)
    print(f"Backed up the published rules to {os.path.relpath(BACKUP_FILE, ROOT)}")

    status, body = call("PUT", f"{RULES_URL}?access_token={urllib.parse.quote(token)}", payload)
    print(f"Publish: HTTP {status} {explain(status, body)}")
    if status != 200:
        sys.exit(1)

    status, body = published_rules(token)
    if status == 200 and json.loads(body) == payload:
        print("Verified: the published rules now match database.rules.json.")
    else:
        print("Warning: the published rules do not match the file. Check the console.")


if __name__ == "__main__":
    main()
