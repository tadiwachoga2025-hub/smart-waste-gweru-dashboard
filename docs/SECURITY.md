# Security — SmartWaste Gweru

What protects what, how the pieces fit, and what to do when something leaks.
Written for the people who have to defend this project, not for a checklist.

## The shape of the system

```
ESP32 ──HTTPS──> Firebase Realtime Database ──> engine.py (predict + route)
   │                    ▲                              │
   │                    │                              ▼
   └── readings ──>  /bins                        /logistics, /publicBins
                                                        │
                        browser (Vercel PWA) ──────────┘
                             ▲
                             └── Firebase Authentication (who the user is)
```

Three trust boundaries sit between a sensor and a screen:

1. **The device token.** A device proves it is a device with a Firebase Auth
   ID token, and the rules grant it write access to `/bins/<id>` only.
2. **The database rules.** `database.rules.json` is the security boundary.
   Every read and write is checked against it. A hidden button in React is
   not a control; the rules are.
3. **The session.** A person signs in with Firebase Authentication, and the
   rules check the role, status and grants stored under `/users/<uid>`.

Admin SDK writes (engine.py, the seed script) bypass the rules entirely.
That is deliberate — the engine is the only writer of `prediction` — and it
is also why the service-account key must be treated as the crown jewel.

## The two 401s a sensor can hit

| Response | Cause | Fix |
|---|---|---|
| `401 {"error": "Permission denied"}` | The account has no profile, or its `/users/<uid>` record is not `role: "device"` + `status: "active"` | `scripts/provision_device.py` |
| `401 {"error": "Unauthorized request."}` | The ID token was sent as an `Authorization: Bearer` header | Put it in the query string: `?auth=<idToken>` |

Realtime Database REST accepts the ID token in the query string only. The
`Authorization` header form is a Firestore idiom and is refused here.

Full walkthrough, with the firmware request shape: `docs/DEVICES.md`.

## Secrets and where they live

| Secret | Where it lives | Who may read it |
|---|---|---|
| Service-account key (`*-firebase-adminsdk-*.json`) | On the engine host, mounted read-only; GitHub Actions secret `FIREBASE_SERVICE_ACCOUNT` | Engine, CI, you |
| Device password / refresh token | `device-credentials.local` (mode 600, gitignored) and the device's own flash | Operator, the device |
| SMTP app password | `settings/smtp` in the database (admin-only read) and `.env` on the engine host | Administrators, the engine |
| Demo account passwords | `demo-accounts.local` (mode 600, gitignored) | Anyone at a pitch — they are demo accounts |
| Firebase web config (`firebase-config.json`) | In the browser bundle, by design | Everyone |

The web config is not a secret. Firebase ships it to every browser that
loads the app. What matters is that the API key is **restricted** (below) and
that the rules carry the real authorisation.

`.gitignore` keeps the key, `.env*` and every `*.local` file out of the
repository. `scripts/scan_secrets.sh` runs in CI over both the working tree
and the full history, so a mistake fails the build instead of shipping.

## Hardening checklist

Done in this repository:

- [x] The service-account key, `.env.local` and the `*.local` credential
      files are mode `600` on disk.
- [x] The key, `.env*` and `*.local` files are gitignored, and a CI job
      (`secrets`) fails the build if one of them is ever tracked.
- [x] The database root denies everything (`.read: false`, `.write: false`);
      every node grants access explicitly.
- [x] A device may only write the sensor fields, each with a validated
      range, and only to a bin that staff already registered. It cannot
      write `prediction`, cannot invent fields, and cannot create bins.
- [x] `audit` entries are append-only, and an actor may only describe
      themselves truthfully (uid, role and name must match their profile).
- [x] The SMTP password is write-only in the dashboard: it is never read
      back into the browser, and it is scrubbed out of logs and alert
      records.
- [x] The rules are generated from one source (`scripts/build-rules.mjs`)
      so the role matrix in the rules and in `src/lib/rbac.js` cannot drift.

Still to do, in the Firebase console (needs an owner account):

- [ ] **Restrict the web API key.** Google Cloud console → APIs & Services →
      Credentials → *Browser key (Auto created by Firebase)* → Application
      restrictions → limit to *Websites* and add
      `smart-waste-dashboard-rust.vercel.app` and `localhost`. Then restrict
      the API to only the Firebase services the project uses. A leaked key
      is then useless from anywhere else.
- [x] **Give the service account the right role.** The engine's key can
      publish the rules through `scripts/publish_rules.py`; `--check`
      reports that the repo and the live rules are identical. The token
      must go in `?access_token=` with the `firebase.database` and
      `userinfo.email` scopes — a bare `Authorization` header is refused.
- [ ] **Enable App Check** for the web build if the dashboard is ever
      exposed publicly (reCAPTCHA v3 does not apply to the ESP32 fleet).
- [ ] **Turn on multi-factor authentication** for the administrator and
      officer accounts.
- [ ] **Turn off email-password sign-in for accounts nobody uses**, and
      delete the demo accounts after the pitch.

## Rotating things

**Service-account key (the important one).**

1. Google Cloud console → the project → Service accounts → the
   `firebase-adminsdk-fbsvc` account → Keys → Add key → JSON.
2. Put the new file on the engine host, replace the old one, `chmod 600`.
3. Update the `FIREBASE_SERVICE_ACCOUNT` GitHub secret.
4. Delete the old key in the console. The old file stops working
   immediately.

**Device credentials.** The firmware should hold a refresh token, not the
password:

```bash
.venv/bin/python scripts/provision_device.py --rotate   # new password + token
.venv/bin/python scripts/device_reading.py bin1 --fill 5 # confirm the new one works
.venv/bin/python scripts/provision_device.py --revoke   # if the device is lost
```

Revoking deletes the Auth user, which invalidates every refresh token that
device holds.

**Database rules.** `database.rules.json` is the source of truth.

```bash
.venv/bin/python scripts/publish_rules.py --check   # repo matches live?
.venv/bin/python scripts/publish_rules.py            # publish + verify
.venv/bin/python scripts/publish_rules.py --restore  # roll back
```

The script backs up the published rules to
`database.rules.published.bak.json` before overwriting them.

## Where the readings actually travel

Today a reading leaves the device, crosses the internet, and lands in a
Google-hosted database. The dashboard reads it back over the same path. That
is the design the project is built on, and it works — but it means the
readings are only as private as the database rules.

If the readings must never leave the local network, the change is small
because the database URL is configuration, not code:

1. Run a Realtime Database-compatible server on the LAN (the Firebase
   emulator is the quickest way to try this) and point
   `VITE_FIREBASE_DATABASE_URL` at it.
2. Point the firmware at the same host.
3. Keep Firebase Authentication for sign-in, or move it too.

`firebase-config.json` and the `VITE_FIREBASE_*` variables exist so that
this switch is an environment change, not a code change.

## What a reviewer should be able to show

- A resident cannot read another resident's complaint: the rules check
  `newData.child('citizenUid').val() === auth.uid`.
- A driver cannot see another driver's job: the rules check
  `data.child('driverUid').val() === auth.uid`.
- A device cannot write a prediction, invent a bin, or leave the campus:
  `role: "device"` reaches exactly the sensor fields of an existing bin.
- Every privileged action is in `/audit`, and an actor cannot forge an
  entry about someone else.
- A leaked service-account key is the only thing that bypasses the rules —
  and it is not in the repository, not in the CI logs, and rotates in
  minutes.
