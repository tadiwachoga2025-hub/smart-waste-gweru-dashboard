"""Create demo accounts (one per role) and sample data for a pitch.

    .venv/bin/python scripts/seed_demo.py            # create everything
    .venv/bin/python scripts/seed_demo.py --remove   # delete everything it made

Uses the same service account as engine.py (Admin SDK), so it needs no login.
Every record it writes carries `demo: true`, which is what --remove looks for,
so real data (bins, your administrator account) is never touched.

Demo logins are generated at random and written to demo-accounts.local, a
gitignored file (mode 600). Passwords are never printed or committed.
Emails use Gmail "+" aliases, so mail for them lands in the base inbox.
"""
import argparse
import os
import secrets
import sys
import time

import firebase_admin
from firebase_admin import auth, credentials, db

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
KEY = os.path.join(ROOT, "smart-waste-gweru-firebase-adminsdk-fbsvc-7281635fb4.json")
CREDS_FILE = os.path.join(ROOT, "demo-accounts.local")
BASE_EMAIL = "leetanmannnn@gmail.com"  # the administrator; aliases hang off it

ACCOUNTS = [
    ("officer", "Demo Officer", "officer"),
    ("driver", "Demo Driver", "driver"),
    ("technician", "Demo Technician", "technician"),
    ("citizen", "Demo Resident", "citizen"),
]
COLLECTIONS = ["trucks", "jobs", "issues", "complaints", "devices", "maintenance"]
MIN = 60_000
HOUR = 60 * MIN
DAY = 24 * HOUR


def alias(tag):
    local, domain = BASE_EMAIL.split("@")
    return f"{local}+{tag}@{domain}"


def password():
    # 16 chars, no look-alikes (0/O, 1/l/I), one symbol so it satisfies any policy
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(15)) + secrets.choice("!#$%")


def init():
    if not os.path.exists(KEY):
        sys.exit("Service-account key not found next to engine.py.")
    firebase_admin.initialize_app(
        credentials.Certificate(KEY),
        {"databaseURL": "https://smart-waste-gweru-default-rtdb.firebaseio.com/"},
    )


def remove():
    removed = 0
    for tag, _name, _role in ACCOUNTS:
        email = alias(tag)
        try:
            user = auth.get_user_by_email(email)
        except auth.UserNotFoundError:
            continue
        db.reference(f"users/{user.uid}").delete()
        auth.delete_user(user.uid)
        removed += 1
        print(f"  deleted account {email}")
    for node in COLLECTIONS:
        data = db.reference(node).get() or {}
        for key, rec in data.items():
            if isinstance(rec, dict) and rec.get("demo") is True:
                db.reference(f"{node}/{key}").delete()
                removed += 1
    if os.path.exists(CREDS_FILE):
        os.remove(CREDS_FILE)
        print("  deleted demo-accounts.local")
    print(f"Removed {removed} demo items. Real bins and your administrator account were not touched.")


def seed():
    existing = []
    for tag, _n, _r in ACCOUNTS:
        try:
            auth.get_user_by_email(alias(tag))
            existing.append(alias(tag))
        except auth.UserNotFoundError:
            pass
    if existing:
        sys.exit(f"Demo accounts already exist ({', '.join(existing)}). Run with --remove first.")

    now = int(time.time() * 1000)
    bins = db.reference("bins").get() or {}
    if not bins:
        sys.exit("There are no bins in the database to build demo data from.")
    ordered = sorted(bins.items(), key=lambda kv: -float(kv[1].get("fillLevel", 0) or 0))

    # --- accounts -----------------------------------------------------------
    uids, lines = {}, []
    for tag, name, role in ACCOUNTS:
        pw = password()
        user = auth.create_user(email=alias(tag), password=pw, display_name=name, email_verified=True)
        uids[role] = user.uid
        db.reference(f"users/{user.uid}").set({
            "name": name, "email": alias(tag), "role": role,
            "status": "active", "createdAt": now, "demo": True,
        })
        lines.append(f"{role:<11} {alias(tag):<42} {pw}")
        print(f"  created {role}: {alias(tag)}")
    fd = os.open(CREDS_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("SmartWaste demo logins (sample accounts, safe to delete: scripts/seed_demo.py --remove)\n")
        f.write(f"{'role':<11} {'email':<42} password\n")
        f.write("\n".join(lines) + "\n")

    # --- trucks -------------------------------------------------------------
    db.reference("trucks").push({"label": "Truck 1", "plate": "DEMO-01", "status": "in-service",
                                 "createdAt": now - 3 * DAY, "demo": True})
    db.reference("trucks").push({"label": "Truck 2", "plate": "DEMO-02", "status": "available",
                                 "createdAt": now - 3 * DAY, "demo": True})

    def stop(bin_id, b, done=False, at=None):
        s = {"binId": bin_id, "location": b.get("location", bin_id), "lat": b.get("lat"), "lng": b.get("lng"),
             "fillLevel": b.get("fillLevel", 0), "prediction": b.get("prediction", "Pending"), "done": done}
        if done and at:
            s["doneAt"] = at
        return s

    officer_name = "Demo Officer"
    # --- jobs: one in progress for the driver, three completed for the reports ---
    live_stops = [stop(k, v, done=(i == 0), at=now - 10 * MIN if i == 0 else None) for i, (k, v) in enumerate(ordered)]
    db.reference("jobs").push({
        "title": f"Route · {len(live_stops)} stops", "driverUid": uids["driver"], "driverName": "Demo Driver",
        "truck": "Truck 1 · DEMO-01", "priority": "high", "status": "started", "source": "ai-route",
        "notes": "Great Hall first, it is at capacity.", "createdBy": uids["officer"], "createdByName": officer_name,
        "createdAt": now - 40 * MIN, "startedAt": now - 25 * MIN, "stops": live_stops, "demo": True,
    })
    for days_ago, mins in ((1, 38), (2, 44), (4, 31)):
        t0 = now - days_ago * DAY
        stops = [stop(k, v, done=True, at=t0 + 15 * MIN) for k, v in ordered]
        db.reference("jobs").push({
            "title": f"Route · {len(stops)} stops", "driverUid": uids["driver"], "driverName": "Demo Driver",
            "truck": "Truck 1 · DEMO-01", "priority": "normal", "status": "completed", "source": "ai-route",
            "createdBy": uids["officer"], "createdByName": officer_name, "createdAt": t0 - 20 * MIN,
            "startedAt": t0, "completedAt": t0 + mins * MIN, "stops": stops, "demo": True,
        })

    # --- driver issues ------------------------------------------------------
    first_bin = ordered[0][0]
    db.reference("issues").push({
        "jobId": "demo", "driverUid": uids["driver"], "driverName": "Demo Driver", "type": "inaccessible-bin",
        "binId": first_bin, "note": "A delivery van is parked across the bin enclosure. Waiting for it to move.",
        "status": "open", "createdAt": now - 12 * MIN, "demo": True,
    })
    db.reference("issues").push({
        "jobId": "demo", "driverUid": uids["driver"], "driverName": "Demo Driver", "type": "breakdown",
        "note": "Hydraulic lift stuck, fixed on site after ten minutes.", "status": "resolved",
        "createdAt": now - 2 * DAY, "resolvedBy": uids["officer"], "resolvedAt": now - 2 * DAY + 50 * MIN, "demo": True,
    })

    # --- citizen complaints, one in every state -----------------------------
    b0, b1 = ordered[0][1], ordered[min(1, len(ordered) - 1)][1]
    base = {"citizenUid": uids["citizen"], "citizenName": "Demo Resident", "demo": True}
    complaints = [
        dict(type="overflowing_bin", note="The bin outside the hall has been overflowing since the weekend and the smell is getting bad.",
             lat=b0.get("lat"), lng=b0.get("lng"), address="Outside the Great Hall", binId=ordered[0][0],
             status="new", createdAt=now - 35 * MIN),
        dict(type="missed_collection", note="Nobody collected from the chapel car park on Tuesday as scheduled.",
             lat=b1.get("lat"), lng=b1.get("lng"), address="Chapel car park", status="reviewing",
             createdAt=now - 5 * HOUR, reviewedBy=uids["officer"]),
        dict(type="overflowing_bin", note="Bags are piling up beside the bin near the library entrance.",
             lat=-19.5152, lng=29.8402, address="Library entrance", status="assigned",
             createdAt=now - 1 * DAY, reviewedBy=uids["officer"],
             officerNote="A crew is scheduled for this afternoon's route."),
        dict(type="overflowing_bin", note="The bin by the cafeteria was full and bins were being left open.",
             lat=-19.5148, lng=29.8395, address="Cafeteria", status="resolved", createdAt=now - 3 * DAY,
             reviewedBy=uids["officer"], resolvedAt=now - 3 * DAY + 4 * HOUR,
             officerNote="Emptied and the lid repaired. Thank you for telling us."),
        dict(type="other", note="Someone dumped a mattress next to the bin shelter.",
             lat=-19.5145, lng=29.8399, address="Bin shelter, east gate", status="rejected",
             createdAt=now - 4 * DAY, reviewedBy=uids["officer"],
             officerNote="Bulky items are collected by the estates office, please contact them on the campus line."),
    ]
    for c in complaints:
        c = {k: v for k, v in c.items() if v is not None}
        db.reference("complaints").push({**base, **c})

    # --- sensors ------------------------------------------------------------
    for k, v in ordered:
        db.reference(f"devices/{k}").set({
            "binId": k, "model": "ESP32 + ultrasonic level sensor", "firmware": "1.2.0", "status": "active",
            "installedAt": now - 30 * DAY, "notes": "Installed by the demo technician.",
            "updatedAt": now - 2 * DAY, "demo": True,
        })
    tech = {"techUid": uids["technician"], "techName": "Demo Technician", "demo": True}
    db.reference("maintenance").push({**tech, "binId": first_bin, "type": "calibration",
                                      "note": "Recalibrated the empty-bin distance after the lid was replaced.",
                                      "createdAt": now - 2 * DAY})
    db.reference("maintenance").push({**tech, "binId": ordered[-1][0], "type": "inspection",
                                      "note": "Checked wiring and enclosure seal. Readings are stable.",
                                      "createdAt": now - 9 * DAY})
    print("  seeded trucks, jobs, issues, complaints, devices and maintenance")
    print("\nDone. Logins are in demo-accounts.local (not committed, not printed).")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--remove", action="store_true", help="delete all demo accounts and sample data")
    args = ap.parse_args()
    init()
    remove() if args.remove else seed()
