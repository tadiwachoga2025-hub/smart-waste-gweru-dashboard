# SmartWaste Gweru dashboard

React + Vite PWA for SmartWaste Gweru: bin monitoring, AI predictions, route dispatch and citizen
complaints. Firebase (Authentication + Realtime Database) with a Python engine (`engine.py`).
Production: https://smart-waste-dashboard-rust.vercel.app

## Demo accounts

Sign in with these demo-only logins:

| Role | Email | Password |
|---|---|---|
| Officer | leetanmannnn+officer@gmail.com | officer123 |
| Driver | leetanmannnn+driver@gmail.com | driver123 |
| Technician | leetanmannnn+technician@gmail.com | technician123 |
| Citizen | leetanmannnn+citizen@gmail.com | citizen123 |

These are demo-only credentials for a demo project — simple on purpose so anyone at a pitch can
type them. Never use them (or the `leetanmannnn+*` addresses) for real accounts.

### Reset or recreate them

| Command | What it does |
|---|---|
| `.venv/bin/python scripts/seed_demo.py --rekey` | Reset the passwords of the existing demo accounts to the table above |
| `.venv/bin/python scripts/seed_demo.py --remove` | Delete the demo accounts and all sample data (`demo: true` records) |
| `.venv/bin/python scripts/seed_demo.py` | Recreate everything from scratch (run after `--remove`; needs the service-account key) |

The current logins are also listed in `demo-accounts.local` — a gitignored file (mode 600, covered
by the `*.local` rule in `.gitignore`) rewritten by the script. Real data (bins, your administrator
account) is never touched. See `docs/RBAC.md` for what each role can do.

## Sensor readings

The ESP32 fleet writes readings to `/bins/<id>`. The rules only accept a signed-in
account whose profile is `role: "device"`, so that identity has to exist before the
sensors can report — without it every reading is answered with `401 Permission denied`.

| Command | What it does |
|---|---|
| `.venv/bin/python scripts/provision_device.py` | Create or repair the device identity and its `/users` profile |
| `.venv/bin/python scripts/provision_device.py --rotate` | Issue a new password and refresh token for the fleet |
| `.venv/bin/python scripts/provision_device.py --revoke` | Delete the device identity (use it if a device is lost) |
| `.venv/bin/python scripts/device_reading.py bin1 --fill 63` | Send a reading the way the firmware does — the reference client |

`docs/DEVICES.md` has the exact request the firmware should send, the two ways a
sensor gets a 401, and a checklist for each.

## Documentation

- `docs/RBAC.md` — roles, access matrix, data model, demo accounts
- `docs/DEPLOY.md` — Vercel deploys, database rules, environment variables
- `docs/ALERTS.md` — bin-full email alerts (SMTP)
- `docs/DEVICES.md` — ESP32 device identity, sensor readings and the 401 checklist
- `docs/SECURITY.md` — what protects what, key rotation, hardening checklist

## Frontend template notes (Vite)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

### React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
