# ESP32 sensor identities and readings

The Realtime Database rules only allow a signed-in account whose profile has
`role: "device"` and `status: "active"` to write a bin reading. Anything else
is answered with:

```json
401 {"error": "Permission denied"}
```

There are two independent ways to get a 401 from a sensor. Fix both:

1. **No device identity / wrong profile.** Create or repair it with the
   provisioning script.
2. **The token is in the wrong place.** Realtime Database REST accepts the ID
   token in the query string (`?auth=<idToken>`). It does **not** accept an
   `Authorization: Bearer <idToken>` header; that form returns
   `401 {"error": "Unauthorized request."}`.

## Provision the device identity

Run this once from the project root (it needs the service-account key next to
`engine.py`):

```bash
.venv/bin/python scripts/provision_device.py
```

It creates (or repairs) `smart-waste-device@gweru.local`, writes
`/users/<uid>` with `role: "device"`, `status: "active"`, and stores the
sign-in credentials in `device-credentials.local` (mode 600, gitignored).
Nothing secret is printed.

| Command | What it does |
|---|---|
| `.venv/bin/python scripts/provision_device.py` | Create or repair the identity; keep the existing password when possible |
| `.venv/bin/python scripts/provision_device.py --rotate` | Issue a new password and refresh token |
| `.venv/bin/python scripts/provision_device.py --revoke` | Delete the Auth user, its profile, and the local credentials file |

## Send a reading

Use the reference client:

```bash
.venv/bin/python scripts/device_reading.py bin1 --fill 63
```

A successful write prints `OK  200  bin1 fill=63%`. The script signs in with
the device identity and sends:

```http
PATCH https://smart-waste-gweru-default-rtdb.firebaseio.com/bins/bin1.json?auth=<idToken>
Content-Type: application/json

{"fillLevel": 63, "lastUpdated": 1792416129593}
```

The firmware must send exactly that shape:

- **`PATCH`, not `PUT`.** `PUT` replaces the whole bin record and would wipe
  `lat`, `lng`, `location` and the engine's `prediction`.
- **`?auth=<idToken>` in the URL.** Do not use an `Authorization` header.
- **`lastUpdated` is epoch milliseconds**, not a display string.

To mint a fresh ID token from the stored refresh token, use the refresh
endpoint (`https://securetoken.googleapis.com/v1/token?key=<API_KEY>`) with
`grant_type=refresh_token`.

## What the live rules allow

The rules in `database.rules.json` are live and are per field, not a blanket
write on the bin. Check that the repo and the database still agree:

```bash
.venv/bin/python scripts/publish_rules.py --check
```

| Field | Allowed values |
|---|---|
| `fillLevel` | number 0–100 |
| `lastUpdated` | epoch milliseconds, or an ISO-8601 string |
| `battery` | number 0–100 |
| `rssi` | number -120–0 |
| `lat` / `lng` | valid coordinates |
| `location` | string up to 120 characters |

A device can write only those fields **on a bin that already exists**. It
cannot create a new bin and cannot write `prediction` (the engine owns that
through the Admin SDK). If the bin is missing, the write is
`401 Permission denied`; register `/bins/<id>` first (Firebase console or the
seed script), then send readings.

## 401 checklist

| Symptom | Cause | Fix |
|---|---|---|
| `401 Unauthorized request.` | Token was sent as `Authorization: Bearer ...` | Put the ID token in `?auth=` |
| `401 Permission denied` | No profile, or `role`/`status` is wrong | Run `scripts/provision_device.py`, then check `/users/<uid>` |
| `401 Permission denied` after rotating | Firmware still holds the old password/refresh token | Re-run provisioning with `--rotate`, update the device |
| `400 INVALID_PASSWORD` / `EMAIL_NOT_FOUND` | Credentials in `device-credentials.local` are stale | Run `scripts/provision_device.py --rotate` |
| `403` / `Permission denied` on `/users` | A device is not allowed to read the user directory | Expected: the device only needs to write `/bins/<id>` |

Verify the identity without touching data:

```bash
.venv/bin/python scripts/device_reading.py bin1 --fill 63 --dry-run
```

`--dry-run` prints the exact request, including a short-lived token. Do not
paste that output into a chat or commit it.
