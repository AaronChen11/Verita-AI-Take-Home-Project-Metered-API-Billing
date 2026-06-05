# Verita-AI-Take-Home-Project-Metered-API-Billing

Correctness-first metered API billing MVP.

## Workspace Layout

* `backend/`: Express + TypeScript API and background jobs
* `frontend/`: React + Vite dashboard and ops console

## Prerequisites

* Node.js 20 or newer
* Docker Desktop

## Local Setup

1. Copy `.env.example` to `.env`. For local development, the `replace-me` values can be any non-empty strings; they do not need to be real provider secrets.
2. Start Postgres with `docker compose up -d`. The local Docker database listens on `localhost:5433` to avoid conflicting with an existing Postgres on the default `5432` port.
3. Install workspace dependencies with `npm install`.
4. Run database migrations with `npm --workspace backend run migrate:up`.
5. Seed local demo data with `npm run seed`.
6. Recompute hourly usage windows with `npm run aggregate:usage`.
7. Generate invoice line items from usage windows with `npm run generate:invoices`.
8. Run the frontend with `npm run dev:frontend`.
9. Run the backend with `npm run dev:backend`.

The seed script creates a demo customer, price plan, API key hash, usage events, invoices, a credit, and an audit log. It prints the raw demo API key only when the API key row is first inserted; reruns are idempotent but cannot recover the raw token because only the HMAC hash is stored.

## Local URLs And Login

| Interface | URL | Login |
| --- | --- | --- |
| Customer dashboard | `http://localhost:5173` | Use the `mb_live_...` token printed by `npm run seed`. |
| Ops console | `http://localhost:5173/ops` | Use `OPS_SHARED_SECRET` from `.env`; actor can be any email-like string. |
| Backend API | `http://localhost:4000` | Customer routes use bearer API keys; ops routes use `X-Ops-Token`. |

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

## Cloud Demo

The hosted demo is available at:

| Interface | URL | Login |
| --- | --- | --- |
| Hosted app | `https://aaronchen11.org/` | Use the customer API key from the submission email. |
| Hosted ops console | `https://aaronchen11.org/ops` | Use the ops token from the submission email; actor can be any email-like string. |

Demo credentials are intentionally sent separately from the repo so API keys, ops tokens, database URLs, and webhook secrets are not committed.

If `.env.cloud` is provided and you want to run the backend locally against the cloud database:

```bash
npm run dev:backend:cloud
```

Then run the frontend locally:

```bash
npm run dev:frontend
```

Use the same customer API key and ops token from the submission email. The local and cloud flows are otherwise the same.

## Root Commands

* `npm run build`: builds backend and frontend.
* `npm run aggregate:usage`: recomputes hourly usage windows from raw usage events using local `.env`.
* `npm run generate:invoices`: generates monthly invoice line items from usage windows using local `.env`.
* `npm run generate:usage`: inserts deterministic demo usage events for the seeded customer.
* `npm run lint`: runs backend and frontend linting.
* `npm run seed`: creates local demo data and prints the customer API key the first time it inserts the key.
* `npm run test`: runs backend mock-based tests and frontend Vitest unit tests; no Docker required.
* `npm run test:a11y`: runs Playwright + axe smoke checks for login, customer dashboard, and ops console; starts the frontend dev server automatically.
* `npm run test:coverage`: runs frontend Vitest unit tests with V8 coverage output.
* `npm run test:integration`: requires Docker Postgres, migrations, and `.env`; verifies real Postgres constraints and transaction behavior.
* `npm run test:unit`: runs frontend Vitest unit tests for hooks and API client boundaries.
* `npm run typecheck`: runs backend and frontend TypeScript checks.

## Submission Checklist

Before submitting:

* `cp .env.example .env`, then `docker compose up -d`, `npm install`, `npm --workspace backend run migrate:up`, and `npm run seed` work from a clean checkout.
* `npm run seed` prints a `Demo API key token: mb_live_...` value on first insert.
* `npm run aggregate:usage` and `npm run generate:invoices` complete without errors.
* `npm run test` passes.
* `npm run test:integration` passes with Docker Postgres running.
* `npm run typecheck` passes.
* `npm run lint` passes.
* `git ls-files .env .env.cloud backend/.env` prints nothing.
* Hosted cloud demo at `https://aaronchen11.org/` works with the customer API key and ops token provided separately in the submission email.
* Cloud backend local mode, if `.env.cloud` is provided, works with `npm run dev:backend:cloud` plus `npm run dev:frontend`.
* `DESIGN.md` stays within the requested 1,500-2,500 word range.
