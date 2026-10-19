"""Provision the identity the ESP32 fleet uses to publish sensor readings.

    .venv/bin/python scripts/provision_device.py            # create or repair
    .venv/bin/python scripts/provision_device.py --rotate   # new password + token
    .venv/bin/python scripts/provision_device.py --revoke   # delete the identity

Why this exists
---------------
The database rules only let a signed-in account whose profile carries
`role: 'device'` write a reading (`/bins/{id}`). Until such an account exists,
every reading POST is answered by Realtime Database with::

    401 {"error": "Permission denied"}

and no sensor data ever reaches the dashboard. This script creates that
account, writes the matching profile under `/users`, and hands back the
credentials the firmware needs.

Credentials live in `device-credentials.local` (gitignored, mode 600) and are
never printed to stdout, on the same rule the demo logins follow.

Transport note (this is the other half of the 401)
---------------------------------------------------
Realtime Database REST accepts the ID token in the **query string**:

    PATCH /bins/{binId}.json?auth={idToken}

It does **not** accept the `Authorization: Bearer {idToken}` header — that
form is answered with::

    401 {"error": "Unauthorized request."}

Use `scripts/device_reading.py` as the reference client; it shows the exact
request the firmware should send.
"""
import argparse
import json
import os
import secrets
import sys
import time

import firebase_admin
from firebase_admin import auth, credentials, db

import device_credentials
from firebase_project import (
    API_KEY,
    DB_ROOT,
    DB_URL,
    DEFAULT_DEVICE_EMAIL,
    DEFAULT_DEVICE_NAME,
    service_account_key,
)

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CREDS_FILE = device_credentials.CREDS_FILE
SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
REFRESH_URL = "https://securetoken.googleapis.com/v1/token"


def init():
    key = service_account_key()
    if not key:
        sys.exit("Service-account key not found next to engine.py.")
    firebase_admin.initialize_app(
        credentials.Certificate(key),
        {"databaseURL": f"{DB_ROOT}"},
    )


def sign_in(email, password):
    """Sign the device in and return (idToken, refreshToken).

    This is the exact call the firmware makes. It is the Identity Toolkit REST
    endpoint, not the Admin SDK, so the token is bound by the database rules
    and the device can only reach what `role: 'device'` allows.
    """
    import urllib.error
    import urllib.request

    body = json.dumps({
        "email": email,
        "password": password,
        "returnSecureToken": True,
    }).encode()
    request = urllib.request.Request(
        f"{SIGN_IN_URL}?key={API_KEY}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        sys.exit(f"Sign-in failed ({exc.code}): {detail}")
    return data.get("idToken"), data.get("refreshToken")


def provision(email, name, rotate):
    existing = None
    try:
        existing = auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        pass

    password = secrets.token_urlsafe(24)
    if existing and not rotate:
        # Keep the current password: it is in device-credentials.local, and
        # changing it would invalidate the refresh token the firmware holds.
        creds = device_credentials.read() or {}
        password = creds.get("password")
        if not password:
            password = secrets.token_urlsafe(24)
            auth.update_user(existing.uid, password=password)
    elif existing:
        auth.update_user(existing.uid, password=password, display_name=name)
        # A new password alone does not stop the old refresh token working.
        # Revoking the tokens is what makes a rotation a rotation: the device
        # has to come back with the new password.
        auth.revoke_refresh_tokens(existing.uid)
    else:
        existing = auth.create_user(
            email=email, password=password, display_name=name, email_verified=True,
        )

    # The profile is what the rules read: role, status and the active check.
    now = int(time.time() * 1000)
    profile = {
        "name": name,
        "email": email,
        "role": "device",
        "status": "active",
        "createdAt": now,
        "updatedAt": now,
    }
    db.reference(f"users/{existing.uid}").set(profile)

    id_token, refresh_token = sign_in(email, password)

    device_credentials.write({
        "uid": existing.uid,
        "email": email,
        "password": password,
        "refreshToken": refresh_token,
        "databaseURL": DB_ROOT,
        "idToken": id_token,
        "idTokenExpiresAt": int(time.time()) + 3600,
    })

    print(f"Device identity ready: {email} (uid {existing.uid})")
    print("Profile written: /users/{uid} with role=device, status=active")
    print(f"Credentials written to {os.path.relpath(CREDS_FILE, ROOT)} (mode 600, gitignored)")
    print()
    print("The firmware sends exactly this:")
    print(f"  PATCH {DB_URL}/bins/<binId>.json?auth=<idToken>")
    print(f"  Authorization: Bearer <idToken>  ->  401 Unauthorized request.")
    print()
    print("Use scripts/device_reading.py to mint a token and send a test reading.")


def revoke(email):
    try:
        user = auth.get_user_by_email(email)
    except auth.UserNotFoundError:
        print(f"No device account for {email}.")
    else:
        db.reference(f"users/{user.uid}").delete()
        auth.delete_user(user.uid)
        print(f"Revoked {email} (uid {user.uid}) and deleted its profile.")
    if os.path.exists(CREDS_FILE):
        os.remove(CREDS_FILE)
        print(f"Removed {os.path.relpath(CREDS_FILE, ROOT)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--email", default=DEFAULT_DEVICE_EMAIL, help="device account email")
    ap.add_argument("--name", default=DEFAULT_DEVICE_NAME, help="display name for the profile")
    ap.add_argument("--rotate", action="store_true", help="issue a new password and refresh token")
    ap.add_argument("--revoke", action="store_true", help="delete the device identity")
    args = ap.parse_args()
    init()
    if args.revoke:
        revoke(args.email)
    else:
        provision(args.email, args.name, args.rotate)
