# DEVELOPMENT_LOG.md

This log captures implementation decisions, verification results, and trade-offs that should feed into the final `DESIGN.md`.

## 2026-06-03: Phase 1 + Phase 2 Baseline

### Implemented

* Added root npm workspace configuration for `backend` and `frontend`.
* Added an Express + TypeScript backend skeleton with a `/health` handler.
* Added root `.env.example` with `DATABASE_URL`, `OPS_SHARED_SECRET`, `PAYMENT_WEBHOOK_SECRET`, and `API_KEY_PEPPER`.
* Added `docker-compose.yml` with a local Postgres service.
* Added backend migration tooling with `node-pg-migrate`.
* Added initial relational schema migration for core billing tables:
  * `price_plans`
  * `customers`
  * `api_keys`
  * `price_tiers`
  * `usage_events`
  * `usage_windows`
  * `invoices`
  * `invoice_line_items`
  * `credits`
  * `webhook_deliveries`
  * `audit_logs`
  * `job_runs`
* Added schema constraints for correctness boundaries:
  * globally unique `usage_events.request_id`
  * unique hourly `usage_windows(customer_id, window_start)`
  * unique monthly `invoices(customer_id, period_start, period_end)`
  * unique `credits(customer_id, idempotency_key)`
  * unique `webhook_deliveries.provider_event_id`
* Added indexes for the expected usage, invoice, audit, and job queries.
* Added README startup instructions.

### Design Notes

The initial schema is Postgres-first and uses database constraints for the billing correctness boundaries instead of relying only on application checks. Raw usage events are preserved separately from derived hourly windows so aggregation can be recomputed safely.

Credits are invoice-bound in the MVP by making `credits.invoice_id` non-null. This keeps invoice total recalculation explicit and avoids adding account-level credit-balance behavior before it is needed.

The migration includes override metadata on `invoice_line_items` for operational visibility, while the immutable audit trail remains the authoritative record of before/after values and reasons.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

Docker could not be verified in this environment because the Docker daemon was unavailable. The attempted command failed while trying to connect to the local Docker socket, before exercising project configuration.

The migration has not yet been executed against Postgres for the same reason. It should be verified with `docker compose up -d` followed by `npm --workspace backend run migrate:up` once Docker is running locally.

## 2026-06-03: Auth, Security, And DB Infrastructure

### Implemented

* Added a shared Postgres pool module in `backend/src/db/pool.ts`.
* Added API key generation and HMAC hashing helpers in `backend/src/security/apiKeys.ts`.
* Added constant-time string comparison helper in `backend/src/security/constantTime.ts`.
* Added customer authentication middleware in `backend/src/auth/customerAuth.ts`.
* Added ops authentication middleware and a money-moving actor guard in `backend/src/auth/opsAuth.ts`.
* Added Express request context typing in `backend/src/types/express.d.ts`.
* Added focused tests for API key hashing, customer auth, and ops auth.

### Design Notes

The API key implementation uses `HMAC-SHA256(API_KEY_PEPPER, raw_token)` rather than storing plaintext keys. The middleware only attaches tenant context after a hash lookup returns an active key, which keeps downstream customer-facing routes from handling raw credentials.

Ops authentication is intentionally lightweight for the take-home. `X-Ops-Token` gates `/ops` access, and `X-Ops-Actor` is captured as request context so future audit-log writes have a trustworthy actor source. The separate `requireOpsActor` guard exists because read-only ops routes may not need the actor, but money-moving routes must reject requests without it.

Auth, security helpers, and database connection code were split into separate files so upcoming features can reuse them without growing `app.ts` into a catch-all module.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.

### Limitations

The middleware is not wired into real routes yet because the ingestion and ops endpoints have not been implemented. Database-backed API key lookup still needs a repository implementation once seed data and route handlers are added.

## 2026-06-03: Batched Usage Event Ingestion

### Implemented

* Added `POST /v1/events` route construction in `backend/src/routes/events.ts`.
* Added payload validation for batched events with `request_id`, `api_key_id`, `endpoint`, `units`, and `timestamp`.
* Added tenant ownership validation so a customer cannot submit usage under another customer's API key.
* Added Postgres-backed API key repository in `backend/src/repositories/apiKeys.ts`.
* Added Postgres-backed usage event repository in `backend/src/repositories/usageEvents.ts`.
* Implemented usage event insertion with `ON CONFLICT (request_id) DO NOTHING`.
* Wired the ingestion route into app construction and production startup dependencies.
* Added route-level tests for valid ingestion, duplicate accounting, missing customer context, cross-tenant API key rejection, and invalid payloads.

### Design Notes

The ingestion route keeps HTTP validation separate from database writes. The route verifies API key ownership before attempting inserts, while the repository relies on the database `usage_events.request_id` unique constraint for idempotency under retries and concurrent re-delivery.

Duplicate handling is intentionally not treated as a request failure. The repository returns the number of rows inserted, and the route reports `accepted` and `duplicates`, matching the desired idempotent ingestion behavior.

The route and repositories are separate files because ingestion will become a correctness boundary with tests, database behavior, and later aggregation dependencies. Keeping these responsibilities split avoids making `app.ts` or the auth middleware responsible for billing write semantics.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.

### Limitations

The route is wired to application construction, but full end-to-end HTTP verification against a real Postgres database still depends on running Docker locally. The current tests use fake repositories to validate route behavior without requiring database connectivity.

## 2026-06-03: Hourly Usage Aggregation Job

### Implemented

* Added a Postgres advisory-lock runner in `backend/src/db/advisoryLock.ts`.
* Added usage window recomputation repository in `backend/src/repositories/usageWindows.ts`.
* Added aggregation job orchestration in `backend/src/jobs/aggregateUsage.ts`.
* Added a default 48-hour lookback window for late-arriving usage events.
* Added tests for aggregation range calculation, advisory-lock skip behavior, and recompute-upsert SQL shape.

### Design Notes

The aggregation job recomputes hourly windows directly from immutable `usage_events` for a target time range. It does not increment existing totals, because an incremental `+=` approach can double-count if the job reruns after a retry or concurrent invocation.

The upsert target is `usage_windows(customer_id, window_start)`, matching the schema-level uniqueness constraint. Rerunning the same range replaces `total_units` with the recomputed value, which also supports late events that arrive inside the lookback window.

The MVP job lock uses Postgres advisory locks. If another aggregation run already holds the lock, the duplicate run exits with a `skipped` result instead of competing for the same derived rows.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.

### Limitations

This implements the aggregation job service and repository but does not yet add a CLI command or scheduler entrypoint. It also does not write `job_runs` rows yet; that should be added when command execution is wired so job attempts, skips, and failures are observable.

## 2026-06-03: Customer Usage Read API

### Implemented

* Added `GET /v1/usage` route construction in `backend/src/routes/usage.ts`.
* Supported `start`, `end`, `api_key_id`, `granularity`, `limit`, and `cursor` query params.
* Defaulted usage reads to hourly buckets.
* Added daily aggregation support with `granularity=day`.
* Added cursor pagination based on the last returned bucket start.
* Added usage read repository in `backend/src/repositories/usageRead.ts`.
* Read from `usage_windows` when no `api_key_id` filter is present.
* Read from raw `usage_events` when `api_key_id` filtering is requested.
* Validated that filtered `api_key_id` values belong to the authenticated customer.
* Added route and repository tests for hourly usage, daily usage, API key filtering, pagination, and invalid inputs.

### Design Notes

The default usage read path uses `usage_windows`, which matches the MVP aggregation grain of one row per `customer x hour`. This keeps dashboard reads aligned with the derived billing usage state.

The `api_key_id` filter intentionally reads from raw `usage_events` in the MVP because `usage_windows` does not include API key dimension. This preserves the required filter behavior without adding another rollup table before it is needed. At higher scale, this should become a `usage_windows_by_api_key` rollup.

Cursor pagination uses an encoded bucket start timestamp. The repository fetches `limit + 1` rows so the route can return a `next_cursor` without needing a separate count query.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.

### Limitations

The route has unit coverage with fake repositories and SQL-shape repository tests, but it has not yet been exercised against live Postgres because Docker is unavailable in this environment.

## 2026-06-03: Monthly Invoice Generation

### Implemented

* Added tiered pricing calculation in `backend/src/billing/pricing.ts`.
* Added deterministic `half-up` rounding from micro-dollars to cents.
* Added invoice generation repository in `backend/src/repositories/invoices.ts`.
* Added invoice generation job orchestration in `backend/src/jobs/generateInvoices.ts`.
* Used a Postgres advisory lock key for invoice generation job exclusion.
* Used `ON CONFLICT (customer_id, period_start, period_end) DO NOTHING` to make invoice creation idempotent.
* Added tests for tier math, rounding, invoice job locking, existing-invoice reruns, and invoice repository transaction shape.

### Design Notes

Pricing uses integer micro-dollar unit prices and stores final invoice amounts in integer cents. The conversion uses a single `half-up` rounding helper so invoice generation and future invoice recalculation paths can share the same policy.

The invoice job reads each customer's usage from hourly `usage_windows` for the billing period, applies that customer's plan tiers, and creates a draft invoice with line items in one transaction. Existing invoices are treated as skipped rather than overwritten, preserving the rule that generated financial records should not be silently mutated.

The database unique constraint on `(customer_id, period_start, period_end)` is the final idempotency guard. The job-level advisory lock reduces duplicate work, but correctness does not depend only on the lock.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.

### Limitations

The job service is implemented but does not yet have a CLI or scheduler entrypoint. It also creates draft invoices only; issuing invoices, customer invoice read APIs, credits, overrides, and payment webhooks still need to be implemented.
