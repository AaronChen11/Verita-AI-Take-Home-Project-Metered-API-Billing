# Verita-AI-Take-Home-Project-Metered-API-Billing

Correctness-first metered API billing MVP.

## Workspace Layout

* `backend/`: Express + TypeScript API and background jobs
* `frontend/`: React + Vite dashboard and ops console

## Local Setup

1. Copy `.env.example` to `.env`.
2. Start Postgres with `docker compose up -d`. The local Docker database listens on `localhost:5433` to avoid conflicting with an existing Postgres on the default `5432` port.
3. Install workspace dependencies with `npm install`.
4. Run database migrations with `npm --workspace backend run migrate:up`.
5. Seed local demo data with `npm run seed`.
6. Recompute hourly usage windows with `npm run aggregate:usage`.
7. Generate invoice line items from usage windows with `npm run generate:invoices`.
8. Run the frontend with `npm run dev:frontend`.
9. Run the backend with `npm run dev:backend`.

The seed script creates a demo customer, price plan, API key hash, usage events, invoices, a credit, and an audit log. It prints the raw demo API key only when the API key row is first inserted; reruns are idempotent but cannot recover the raw token because only the HMAC hash is stored.

To add more deterministic usage events for the seeded customer:

```bash
DEMO_USAGE_HOURS=24 DEMO_USAGE_EVENTS_PER_HOUR=5 DEMO_USAGE_UNITS_PER_EVENT=100 npm run generate:usage
npm run aggregate:usage
npm run generate:invoices
```

By default, `npm run generate:invoices` generates invoices for the previous complete UTC month. To generate a specific period:

```bash
INVOICE_PERIOD_START=2026-06-01 INVOICE_PERIOD_END=2026-07-01 npm run generate:invoices
```

## Root Commands

* `npm run build`
* `npm run aggregate:usage`
* `npm run generate:invoices`
* `npm run generate:usage`
* `npm run lint`
* `npm run seed`
* `npm run test:a11y` (runs Playwright + axe smoke checks for login, customer dashboard, and ops console)
* `npm run test:integration` (requires local Docker Postgres, migrations, and `.env`)
* `npm run typecheck`
* `npm run test`
