"""Send a sensor reading the way the ESP32 does — the reference implementation.

    .venv/bin/python scripts/device_reading.py bin1 --fill 63
    .venv/bin/python scripts/device_reading.py bin1 --fill 63 --dry-run
    .venv/bin/python scripts/device_reading.py --show-request

This is also the proof that the 401 is gone: the script signs in as the device
identity and writes to `/bins/{binId}` with the credentials the database rules
actually accept. A `200` here means the firmware's request will be accepted
too.

The two things this script exists to get right
-----------------------------------------------
1. The ID token travels in the **query string** (`?auth=`). Realtime Database
   REST rejects the `Authorization: Bearer` header with
   `401 Unauthorized request.`
2. `lastUpdated` is **epoch milliseconds**. The dashboard's freshness check
   cannot read a free-text string, so a reading carrying "Just Now" is
   treated as an unknown age.
3. The write is a **PATCH**, never a PUT. `PUT /bins/{id}.json` replaces the
   whole record and would wipe the bin's `lat`, `lng`, `location` and the
   engine's `prediction`. `PATCH` touches only the fields the device sends.
"""
import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import device_credentials
from firebase_project import API_KEY, DB_URL

SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword"
REFRESH_URL = "https://securetoken.googleapis.com/v1/token"


def _post(url, payload):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")
        sys.exit(f"{exc.code} {detail}")


def sign_in(email, password):
    data = _post(f"{SIGN_IN_URL}?key={API_KEY}", {
        "email": email, "password": password, "returnSecureToken": True,
    })
    return data.get("idToken"), data.get("refreshToken")


def refresh(refresh_token):
    """Exchange the long-lived refresh token for a fresh ID token.

    The firmware should hold the refresh token, not the password: a refresh
    token can be revoked by deleting the account, while a password can only be
    rotated.
    """
    data = _post(f"{REFRESH_URL}?key={API_KEY}", {
        "grant_type": "refresh_token", "refresh_token": refresh_token,
    })
    return data.get("id_token")


def build_payload(args):
    payload = {
        "fillLevel": args.fill,
        "lastUpdated": int(time.time() * 1000),
    }
    if args.battery is not None:
        payload["battery"] = args.battery
    if args.rssi is not None:
        payload["rssi"] = args.rssi
    return payload


def reading_url(bin_id, token):
    """The only URL form Realtime Database accepts for a device write."""
    return f"{DB_URL}/bins/{urllib.parse.quote(bin_id)}.json?auth={token}"


def show_request(bin_id, payload, token):
    """The exact request the firmware should send, ready to copy."""
    url = reading_url(bin_id, token)
    print("PATCH " + url)
    print("Content-Type: application/json")
    print()
    print(json.dumps(payload, indent=2))
    print()
    print("Do NOT send 'Authorization: Bearer <idToken>' — Realtime Database")
    print("answers that with 401 Unauthorized request.")
    print("Use PATCH, not PUT: PUT replaces the record and drops the bin's")
    print("lat/lng/location and the engine's prediction.")


def send(url, payload, method="PATCH"):
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.status, response.read().decode(errors="replace")
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("bin_id", nargs="?", help="bin id, e.g. bin1")
    ap.add_argument("--fill", type=int, default=50, help="fill percentage 0-100")
    ap.add_argument("--battery", type=int, default=None, help="optional battery percentage")
    ap.add_argument("--rssi", type=int, default=None, help="optional wifi RSSI dBm")
    ap.add_argument("--dry-run", action="store_true", help="print the request, send nothing")
    ap.add_argument("--show-request", action="store_true", help="print the request shape only")
    ap.add_argument("--replace", action="store_true", help="PUT instead of PATCH (replaces the record)")
    args = ap.parse_args()

    creds = device_credentials.read()

    if args.show_request:
        payload = build_payload(args)
        show_request(args.bin_id or "<binId>", payload, "<idToken>")
        return

    if not args.bin_id:
        ap.error("bin_id is required (or use --show-request)")

    if not 0 <= args.fill <= 100:
        sys.exit("--fill must be between 0 and 100.")

    id_token, _ = sign_in(creds["email"], creds["password"])
    payload = build_payload(args)
    url = reading_url(args.bin_id, id_token)

    if args.dry_run:
        show_request(args.bin_id, payload, id_token)
        return

    status, body = send(url, payload, method="PUT" if args.replace else "PATCH")
    if status == 200:
        print(f"OK  {status}  {args.bin_id} fill={payload['fillLevel']}%")
        print(f"    wrote {json.dumps(payload)}")
    else:
        print(f"FAILED  {status}  {body}")
        if status == 401:
            print("\n    401 means the write was refused. Check that:")
            print("      - the device profile exists: /users/<uid> with role=device, status=active")
            print("      - the token is in the query string (?auth=), not an Authorization header")
        sys.exit(1)


if __name__ == "__main__":
    main()
