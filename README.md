# Verita-AI-Take-Home-Project-Metered-API-Billing

Correctness-first metered API billing MVP.

## Workspace Layout

* `backend/`: Express + TypeScript API and background jobs
* `frontend/`: React + Vite dashboard and ops console

## Local Setup

1. Copy `.env.example` to `.env`.
2. Start Postgres with `docker compose up -d`.
3. Install workspace dependencies with `npm install`.
4. Run database migrations with `npm --workspace backend run migrate:up`.
5. Seed local demo data with `npm run seed`.
6. Run the frontend with `npm run dev:frontend`.
7. Run the backend with `npm run dev:backend`.

The seed script creates a demo customer, price plan, API key hash, usage events, invoices, a credit, and an audit log. It prints the raw demo API key only when the API key row is first inserted; reruns are idempotent but cannot recover the raw token because only the HMAC hash is stored.

To add more deterministic usage events for the seeded customer:

```bash
DEMO_USAGE_HOURS=24 DEMO_USAGE_EVENTS_PER_HOUR=5 DEMO_USAGE_UNITS_PER_EVENT=100 npm run generate:usage
```

## Root Commands

* `npm run build`
* `npm run generate:usage`
* `npm run lint`
* `npm run seed`
* `npm run typecheck`
* `npm run test`
