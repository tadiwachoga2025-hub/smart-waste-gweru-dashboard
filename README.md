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

## Documentation

- `docs/RBAC.md` — roles, access matrix, data model, demo accounts
- `docs/DEPLOY.md` — Vercel deploys, database rules, environment variables
- `docs/ALERTS.md` — bin-full email alerts (SMTP)

## Frontend template notes (Vite)

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

### React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
