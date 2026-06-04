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

## 2026-06-03: Customer Invoice Read APIs

### Implemented

* Added `GET /v1/invoices` in `backend/src/routes/invoices.ts`.
* Added `GET /v1/invoices/:id` in `backend/src/routes/invoices.ts`.
* Added customer-scoped invoice list and detail repository methods in `backend/src/repositories/invoices.ts`.
* Returned invoice line items and credits on invoice detail.
* Added cursor pagination for invoice listing.
* Wired invoice routes into the authenticated customer `/v1` API.
* Added route and repository tests for customer scoping, list pagination, detail lookup, and not-found behavior.

### Design Notes

Customer invoice reads are scoped by `customer_id` inside the repository methods, not by route-level ID checks alone. The detail endpoint returns 404 when a customer requests an invoice ID outside their tenant, which avoids confirming that another tenant's invoice exists.

Invoice detail returns financial components together: invoice summary fields, line items, and credits. This keeps the customer dashboard and future ops views aligned on the same invoice shape.

Invoice list pagination uses a composite cursor of `(created_at, id)` to match the `ORDER BY created_at DESC, id DESC` sort. This avoids skipping or duplicating invoices when multiple invoices share the same creation timestamp.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.

### Limitations

The endpoints are covered with unit and SQL-shape tests but have not been exercised against live Postgres yet. Invoice issuing, paid status transitions, credit issuance, line-item override, and payment webhooks are still pending.

## 2026-06-03: Payment Webhook

### Implemented

* Added `POST /webhooks/payments` in `backend/src/routes/paymentWebhooks.ts`.
* Added raw-body HMAC signature helpers in `backend/src/security/webhookSignatures.ts`.
* Mounted the payment webhook route before global JSON parsing so signature verification uses the exact received bytes.
* Added payment webhook repository in `backend/src/repositories/paymentWebhooks.ts`.
* Inserted `webhook_deliveries` with `ON CONFLICT (provider_event_id) DO NOTHING` for replay safety.
* Marked invoices as `paid` transactionally after recording a new webhook delivery.
* Rolled back webhook processing if the target invoice cannot be marked paid.
* Returned no-op success for duplicate provider events.
* Added route, signature, and repository tests.

### Design Notes

Webhook verification uses the raw `Buffer` from `express.raw()` rather than parsed JSON. The route only parses JSON after the signature has been verified, which avoids mismatches from whitespace or key-order normalization.

Webhook replay protection is based on the provider event ID unique constraint. A duplicate event does not reapply invoice state changes and returns success so payment providers can stop retrying.

The MVP webhook payload is intentionally narrow: `invoice.paid` with a provider event ID and invoice ID. This keeps the local payment flow deterministic without pretending to implement a full external payment provider.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

This is a local payment webhook contract, not a real Stripe integration. The route does not yet write audit logs because payment-provider events are system callbacks rather than ops actor actions.

## 2026-06-03: Ops Read APIs

### Implemented

* Added `GET /ops/customers` in `backend/src/routes/ops.ts`.
* Added `GET /ops/customers/:id` in `backend/src/routes/ops.ts`.
* Added ops read repository in `backend/src/repositories/opsReads.ts`.
* Wired `/ops` routes behind `X-Ops-Token` auth.
* Added customer list pagination with a composite `(created_at, id)` cursor.
* Added customer detail response with customer summary, usage summary, recent invoices, and audit trail.
* Added anomaly signal using `current_hour_units > 10x average_hourly_units_last_30_days`.
* Added route, repository, and app wiring tests.

### Design Notes

Ops read APIs are protected by the shared ops token but do not require `X-Ops-Actor`, because they do not move money or mutate financial state. Money-moving ops endpoints will use `requireOpsActor` when credits and line-item overrides are implemented.

The anomaly signal is intentionally simple and read-only. It is an ops hint computed from `usage_windows`; it does not modify usage, invoices, credits, billing calculations, or customer-visible state.

The customer list cursor includes both `created_at` and `id` to match the descending sort order. This avoids unstable pagination when customers share a creation timestamp.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

The endpoints are covered with unit and SQL-shape tests but have not been exercised against live Postgres yet. The audit trail currently filters by `entity_id = customer_id`; future ops detail views may also include invoice-level audit entries for the customer's invoices.

## 2026-06-03: Ops Credit Issuance

### Implemented

* Added `POST /ops/customers/:id/credits` in `backend/src/routes/ops.ts`.
* Required `X-Ops-Actor` for credit issuance.
* Required `invoice_id`, `amount_cents`, `reason`, and `idempotency_key`.
* Added invoice-bound credit repository in `backend/src/repositories/credits.ts`.
* Inserted credits transactionally with `ON CONFLICT (customer_id, idempotency_key) DO NOTHING`.
* Locked the target invoice before applying credit changes.
* Recalculated invoice `credits_cents` and `total_cents` transactionally.
* Wrote an `audit_logs` entry with before and after invoice totals.
* Returned no-op success for duplicate idempotency keys.
* Added route and repository tests for actor enforcement, validation, idempotency, invoice total recalculation, rollback, and audit logging.

### Design Notes

Credits are invoice-bound in the MVP. The route requires `invoice_id`, and the repository verifies the invoice belongs to the target customer before inserting the credit.

Credit issuance is a money-moving ops action, so it requires `X-Ops-Actor`. The actor is persisted as both `credits.created_by` and `audit_logs.actor`, which gives the MVP a trustworthy actor source without implementing full SSO/RBAC.

Duplicate credit requests use `(customer_id, idempotency_key)` as the idempotency boundary. A duplicate request returns the existing credit and its invoice totals without writing another credit or audit log.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

The route and repository are covered with unit and SQL-shape tests but have not been exercised against live Postgres yet. Credits cannot exceed invoice subtotal at the invoice total level because totals are clamped to zero, but the MVP does not yet enforce a business rejection for over-crediting.

## 2026-06-03: Ops Line-Item Overrides

### Implemented

* Added `PATCH /ops/invoices/:invoiceId/line-items/:lineItemId` in `backend/src/routes/ops.ts`.
* Required `X-Ops-Actor` for line-item overrides.
* Required `amount_cents` and `reason`.
* Added line-item override repository in `backend/src/repositories/lineItemOverrides.ts`.
* Locked the target invoice and line item before mutation.
* Allowed overrides for `draft` and `issued` invoices.
* Rejected direct overrides for `paid` invoices.
* Updated line-item override metadata: `is_overridden`, `overridden_at`, `override_reason`, and `overridden_by`.
* Recalculated invoice `subtotal_cents` and `total_cents` transactionally.
* Wrote an immutable audit log entry with before and after snapshots.
* Added route and repository tests for actor enforcement, paid invoice rejection, missing line items, total recalculation, and audit logging.

### Design Notes

Line-item override is a money-moving ops action, so it requires `X-Ops-Actor` and a reason. The actor becomes the audit actor and the `overridden_by` value on the line item.

Paid invoices reject direct line-item mutation. Corrections after payment should go through credits or a future correction flow so finalized financial records are not silently rewritten.

Invoice totals are recalculated from all line items after the override, then credits are applied with a zero floor on total cents. This keeps override behavior consistent with credit recalculation and avoids stale invoice totals.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

The route and repository are covered with unit and SQL-shape tests but have not been exercised against live Postgres yet. The MVP does not keep historical versions of line items beyond audit log before/after snapshots.

## 2026-06-03: Seed And Demo Data

### Implemented

* Added deterministic demo IDs in `backend/src/scripts/demoIds.ts`.
* Added `npm run seed` backed by `backend/src/scripts/seed.ts`.
* Added `npm run generate:usage` backed by `backend/src/scripts/generateUsage.ts`.
* Seeded a demo price plan, price tiers, customer, hashed API key, usage events, invoices in different statuses, a credit, and an audit log.
* Generated the raw demo API key only on first API key insert and persisted only the HMAC hash.
* Made usage generation deterministic with stable `request_id` values so reruns do not duplicate usage.
* Updated README with seed and usage generator commands.

### Design Notes

The seed script respects the API key storage model: it prints the raw demo token only when inserting the key for the first time, then stores only `HMAC-SHA256(API_KEY_PEPPER, token)`. Reruns cannot recover the token, which matches production behavior.

The usage generator writes directly to `usage_events` with deterministic request IDs. This lets local demos repeatedly create or top up sample data without breaking ingestion idempotency semantics.

Seeded invoices include `draft`, `issued`, and `paid` states so customer invoice reads, ops credits, line-item override rules, and paid-invoice rejection can be exercised locally.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

The scripts are typechecked but have not been executed against live Postgres yet. Running `migrate:up`, `seed`, and `generate:usage` requires the local database to be started first.

## 2026-06-03: Customer Dashboard Frontend

### Implemented

* Replaced the default Vite page with a customer billing dashboard.
* Added a demo API key input flow with local browser storage.
* Added frontend API client in `frontend/src/lib/api.ts`.
* Added `UsageChart`, `InvoicePanel`, and `CustomerDashboard` components.
* Added hourly/daily usage display controls.
* Added invoice list and invoice detail views with line items and credits.
* Added loading, error, and empty states.
* Added a Vite dev proxy from `/api` to the backend at `localhost:4000`.

### Design Notes

The frontend uses the same customer API contract as the backend: `GET /v1/usage`, `GET /v1/invoices`, and `GET /v1/invoices/:id`. The API key is sent as a bearer token and stored only in local browser storage for the local demo.

The customer UI is intentionally read-only. Billing mutations remain in the ops flows because credits and overrides require `X-Ops-Actor` and audit logging.

The dashboard keeps API client logic, token persistence, charts, and invoice display in separate files so the UI can grow without making `App.tsx` a mixed responsibility file.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

The frontend has been wired and will be build-verified, but it has not yet been exercised against a live backend and seeded database in the browser.

## 2026-06-03: Ops Console Frontend

### Implemented

* Added Customer/Ops view switching in `frontend/src/App.tsx`.
* Added ops token and ops actor input flow with local browser storage.
* Added ops API methods for customer reads, credit issuance, and line-item overrides.
* Added `OpsConsole` component with customer list, customer detail, usage anomaly signal, invoices, audit trail, credit form, and line-item override form.
* Added UI feedback for loading, errors, and successful money-moving actions.
* Added explicit UI copy that paid invoices are rejected for direct line-item overrides.

### Design Notes

Ops reads require only `X-Ops-Token`, while credit and override submissions include both `X-Ops-Token` and `X-Ops-Actor`. This mirrors the backend auth split: read-only ops routes are lightweight, and money-moving actions require a trustworthy actor for auditability.

The override form currently asks for invoice and line-item IDs manually because the ops read endpoint returns invoice summaries, not invoice line items. This avoids expanding backend read contracts during the frontend phase.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

### Limitations

The ops console is build-verified but has not yet been exercised against a live backend and seeded database in the browser. A more polished ops UX would add invoice detail expansion before line-item override.

## 2026-06-03: Local Database Setup Fix

### Implemented

* Updated Docker Postgres host port from `5432` to `5433` while keeping the container port at `5432`.
* Updated `.env.example` and local env files to use `localhost:5433`.
* Kept backend scripts pointed at the root `.env` through explicit dotenv configuration.
* Documented the non-default local database port in README setup instructions.

### Design Notes

The take-home should not require the reviewer to stop an existing local Postgres service. Mapping the project database to `5433` keeps the Docker database isolated while preserving standard Postgres defaults inside the container.

The backend workspace scripts load `../.env` so commands run from the monorepo root through npm workspaces consistently receive the required database URL and local secrets.

### Verification

* `docker compose up -d` started the local Postgres container on `localhost:5433`.
* `npm --workspace backend run migrate:up` applied the initial schema migration successfully.
* `npm run seed` inserted the deterministic demo customer, API key, invoices, credits, audit log, and 216 usage events successfully.

## 2026-06-03: Live Demo Aggregation Command

### Implemented

* Added `backend/src/scripts/aggregateUsage.ts` as a dedicated CLI wrapper around the existing hourly aggregation job.
* Added root and backend `aggregate:usage` npm scripts.
* Updated README setup so local demo data is seeded and then recomputed into `usage_windows` before opening the dashboard.

### Design Notes

The customer usage endpoint reads hourly buckets from `usage_windows`, so seeded `usage_events` must be aggregated before the dashboard can show non-empty usage. Keeping aggregation as an explicit command makes the demo flow honest: ingestion, rollup, and reads remain separate stages.

The script uses the same Postgres advisory lock path as the production job function, so local execution exercises the real concurrency guard instead of bypassing it.

### Verification

* `npm run aggregate:usage` succeeded against local Docker Postgres.
* The command recomputed the `2026-06-02T00:00:00.000Z` through `2026-06-04T00:00:00.000Z` range and upserted 48 hourly windows.
* `GET /v1/usage` returned hourly buckets with 750 units per hour and daily buckets with 18000 units per day for the seeded data.

## 2026-06-03: Ops Audit Read Fix

### Implemented

* Updated ops customer detail reads to include audit logs attached to the customer's invoices.
* Updated ops customer detail reads to include audit logs attached to invoice line items under the customer's invoices.
* Added repository test coverage for customer-related invoice and line-item audit lookup.

### Design Notes

Credit creation writes audit rows against the invoice, and line-item override writes audit rows against the invoice line item. The ops customer detail page needs the full customer financial trail, so the read model must collect audits through those relationships instead of only matching the customer id directly.

### Verification

* Live ops customer detail returned invoice and invoice-line-item audit rows after credit and override actions.
* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

## 2026-06-03: Live API Verification

### Implemented

* Started the backend dev server on `localhost:4000`.
* Started the frontend Vite dev server on `localhost:5176`.
* Verified customer invoice reads against the seeded database.
* Verified ops customer detail reads against the seeded database.
* Verified ops credit issuance updates invoice totals and creates audit history.
* Verified issued-invoice line-item override updates invoice totals and creates audit history.
* Verified paid-invoice line-item override is rejected with `paid_invoice_cannot_be_overridden`.

### Design Notes

The live verification exercised the same local env, Docker Postgres, Express routes, and seeded records that a reviewer will use. This caught the missing aggregation CLI and the customer-detail audit read gap before final documentation.

The in-app browser automation surface was unavailable in this session, so UI interaction was not browser-click verified. The frontend dev server did serve the Vite app shell successfully, and the backend contracts used by the UI were verified directly.

### Verification

* `GET /v1/invoices` returned seeded invoice summaries.
* `GET /v1/invoices/:id` returned line items and invoice-bound credits.
* `GET /ops/customers/:id` returned usage summary, invoice summaries, and related audit logs.
* `POST /ops/customers/:id/credits` returned updated invoice totals.
* `PATCH /ops/invoices/:invoiceId/line-items/:lineItemId` succeeded for an issued invoice and returned 409 for a paid invoice.

## 2026-06-03: DESIGN.md Finalization Pass

### Implemented

* Updated `DESIGN.md` from the accumulated development log.
* Documented the local demo flow, including `npm run aggregate:usage`.
* Documented the host `5433` Postgres mapping used to avoid local port conflicts.
* Updated verification status with live Docker, migration, seed, aggregation, API, and frontend shell results.
* Removed stale limitations that were resolved during live verification.

### Design Notes

The design document now separates automated verification, live local API verification, and the remaining manual browser walkthrough. This keeps the submission honest about what was machine-verified and what a reviewer can reproduce in the browser.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

## 2026-06-03: DESIGN.md Rubric Feedback Pass

### Implemented

* Added a dedicated `Trade-offs` section covering recomputation, API key hashing, invoice-bound credits, and lightweight ops auth.
* Rewrote the threat model around hostile customer, hostile ops user, and compromised webhook scenarios.
* Replaced generic failure-mode notes with production-scale breakpoints and concrete fixes.
* Added an `Observability` section with structured metrics and alert conditions.

### Design Notes

This pass addresses reviewer-facing rubric gaps without changing runtime behavior. The new sections make the chosen MVP shortcuts explicit and show the concrete production path for scale, security, and operations.

### Verification

Documentation-only change. Full test/lint/typecheck/build verification should be run before commit.

## 2026-06-03: Ops UX And Scale Feedback Pass

### Implemented

* Added ops credit and line-item override confirmation prompts in the frontend.
* Added invoice line items to `GET /ops/customers/:id` so ops users can see and click line item IDs.
* Returned audit log before/after values from ops customer detail.
* Added frontend rendering for invoice IDs, line item IDs, and audit before/after JSON.
* Added a migration that promotes money and usage counters to `bigint`.
* Added active API key hash and audit entity lookup indexes.
* Added `job_runs` persistence for the local usage aggregation command.

### Design Notes

The ops UI now exposes the identifiers required to manually test line-item overrides instead of forcing reviewers to know seeded IDs. Confirmation prompts make money-moving actions harder to trigger accidentally.

The schema changes are isolated in a new migration rather than mutating the initial migration. The Postgres pool parses `int8` values back to numbers so the API response shape remains stable after the counter columns become `bigint`.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.
* `npm --workspace backend run migrate:up` applied the scale/index migration successfully.
* `npm run aggregate:usage` recorded a successful `aggregateUsage` row in `job_runs`.
* Live ops customer detail returned invoice line items and audit before/after values.

## 2026-06-03: DESIGN.md Trim And DB Integration Tests

### Implemented

* Trimmed `DESIGN.md` by removing repeated summary and verification sections.
* Added a dedicated `test:integration` command for real Postgres integration tests.
* Added integration coverage for `usage_events.request_id` deduplication, `usage_windows` recomputation, ops `jsonb_agg` line item shape, and credit transaction/audit behavior.
* Documented the integration test command in README.

### Design Notes

The integration suite is intentionally separate from default unit tests because it requires Docker Postgres and migrated schema. This keeps `npm run test` fast and deterministic while still giving reviewers a real database verification path.

### Verification

* `DESIGN.md` is 2,485 words.
* `npm run test` passed.
* `npm run test:integration` passed against local Docker Postgres.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.

## 2026-06-03: Verita-Aligned UI Restyle

### Implemented

* Replaced the yellow/green visual system with a Verita-inspired linen, burgundy, warm black, and hairline-border palette.
* Added Cormorant Garamond and DM Sans font loading for the frontend.
* Reduced large rounded corners and heavy shadows to restrained 8-12px radii and light shadows.
* Removed hero and usage-chart gradients in favor of solid near-black burgundy hero surfaces and burgundy accents.
* Updated dashboard and ops hero headings to use roman plus italic display typography.
* Added invoice status badge color states, highlighted applied credits, styled override markers, and normalized audit detail toggles.
* Raised the frontend build chunk warning limit to fit the Recharts-powered demo bundle without masking genuinely large bundles.

### Design Notes

The restyle keeps the existing product flow and component structure intact while aligning the visual language with the Verita references: serif-led typography, small uppercase labels, quiet surfaces, burgundy calls to action, and minimal ornament.

### Verification

* `npm run test` passed.
* `npm run lint` passed.
* `npm run typecheck` passed.
* `npm run build` passed.
* Browser automation was unavailable in this session, so final visual QA should be done manually in the local browser.

## 2026-06-04: Recharts Line Chart And Usage Preview

### Implemented

* Replaced the CSS bar chart in `UsageChart` with a Recharts `<LineChart>` using `type="monotone"` for a smooth curve.
* Added a custom `<Tooltip>` component styled with the design system variables (panel background, Cormorant Garamond for the value, DM Sans for labels).
* Added a dashed burgundy cursor line and a filled dot on the active data point.
* Added a horizontal-only `<CartesianGrid>` and Y-axis formatter that abbreviates values above 1,000 to `k`.
* Removed the old `.usage-bars`, `.usage-bar`, and `.chart-axis` CSS and replaced them with `.chart-tooltip` styles.
* Added 48-point mock hourly data in `App.tsx` that renders a usage chart preview in the customer empty state so the visualization can be evaluated without seeding a database.
* Installed `recharts` as a frontend dependency.

### Design Notes

The smooth line chart better communicates usage trends over time compared to a bar chart. The mock data in the empty state allows visual QA of the chart without requiring a backend connection, and is clearly separated from the live data path.

The Recharts bundle adds roughly 150 kB to the production build. The chunk size warning threshold was raised to 600 kB to acknowledge this intentional dependency without suppressing future genuine size alerts.

### Verification

* `npm run typecheck` passed.
* `npm run build` passed.

## 2026-06-04: Functional Hero Cards

### Implemented

* Replaced the decorative `CustomerDashboard` hero with a live "Current Cycle" widget showing current period label, invoice total, billable units, a four-stage progress bar (Usage → Aggregated → Invoiced → Paid), and a status sentence.
* Derived the hero state from already-loaded `invoices[0]` and `usage` bucket sum — no additional API calls.
* Added helper functions `getCurrentStage`, `getStatusCopy`, and `formatPeriod` for the customer hero logic.
* Replaced the decorative `OpsConsole` hero with a live operational summary showing total customer count, reviewed count, and anomaly count.
* Added `anomalyMap` state to track per-customer anomaly status as ops users browse customer details.
* Updated `loadCustomerDetail` to write each customer's anomaly flag into `anomalyMap` on load.
* Added status text that updates to flag abnormal usage when any reviewed customer has an anomaly.
* Moved the actor identity from a separate pill into the hero eyebrow label.
* Added `.hero-cycle`, `.cycle-amount-row`, `.cycle-amount`, `.cycle-progress-wrap`, `.cycle-bar`, `.cycle-segment`, `.cycle-stages`, `.cycle-status`, `.ops-hero-stats`, and `.ops-hero-stat` CSS classes.

### Design Notes

Both hero cards now show data that changes as the user interacts with the product. The customer hero reflects the current billing state at a glance; the ops hero accumulates anomaly signals as the user browses customers.

The `cycle-amount` uses `font-variant-numeric: tabular-nums` and DM Sans Bold so financial figures render with consistent digit widths on the dark surface.

The four progress-bar stages directly map to `usage_windows` existence, invoice `draft`, invoice `issued`, and invoice `paid` states. This makes the billing pipeline visible without adding a dedicated status API.

### Verification

* `npm run typecheck` passed.
* `npm run build` passed.

## 2026-06-04: UI Polish And Bug Fixes

### Implemented

* Fixed ops console content disappearance on customer selection: removed `setDetail(null)` from the customer click handler, added an `isLoadingDetail` state, and replaced instant content removal with a subtle opacity fade on the usage signal panel while the new detail loads.
* Fixed duplicate credits display in `InvoicePanel`: removed the redundant credits line from the `.totals` row so applied credits appear only in the dedicated `credit-applied` block.
* Changed the minus sign in the credit-applied display from a hyphen to a proper Unicode minus (`−`) for typographic correctness in financial contexts.
* Redesigned the topbar from a floating card to a full-width hairline nav matching the Verita site: removed border-radius and box shadow, added a bottom hairline border, and extended the bar edge-to-edge.
* Replaced the `MB` monogram mark with an uppercase wordmark using DM Sans tracked caps.
* Simplified the view switcher from a background-pill toggle to plain text links where the active state is burgundy bold text, matching the Verita navigation style.
* Added `.panel-refreshing` CSS class with opacity transition for the detail reload state.

### Design Notes

The ops console disappearance bug was caused by the previous `setDetail(null)` call clearing rendered sections before the network response arrived. Keeping stale data visible during the transition is preferable to a blank panel, particularly for a tool where context continuity matters during investigation.

The topbar nav pattern follows the Verita site structure: no background card, single hairline separator, and text-based active states. This reduces visual weight at the top of the page and lets the hero card carry more prominence.

### Verification

* `npm run typecheck` passed.
* `npm run build` passed.
