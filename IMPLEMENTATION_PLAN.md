# IMPLEMENTATION_PLAN.md

## Goal

Build a correctness-first metered API billing MVP that prioritizes:

* Idempotent ingestion
* Tenant isolation
* Recomposable hourly usage aggregation
* Correct monthly invoicing
* Auditable ops actions
* Clear local setup and demo flow

This document is the working implementation checklist for the take-home.

## Frozen Decisions

### `GET /v1/usage`

The endpoint contract is:

* Query params: `start`, `end`, `api_key_id`, `granularity`, `limit`, `cursor`
* Default `granularity=hour`
* Default response shape is hourly buckets backed by `usage_windows`
* For `granularity=day`, aggregate hourly windows into daily totals
* For `api_key_id` filtering in the MVP, aggregate directly from `usage_events`

Trade-off:

* The brief asks for hourly aggregation with one row per `customer x hour`
* The MVP keeps `usage_windows` at that grain for correctness and simplicity
* `api_key_id` filtering therefore falls back to `usage_events`
* At higher scale, add a `usage_windows_by_api_key` rollup table

### Ops Auth

The take-home will not build full ops login.

Ops routes will be protected by:

* `X-Ops-Token`
* `X-Ops-Actor`

Rules:

* `X-Ops-Token` must match `OPS_SHARED_SECRET` from the environment
* `X-Ops-Actor` is the actor recorded in `audit_logs`
* Money-moving ops actions must reject requests when `X-Ops-Actor` is missing
* No secrets are hardcoded in the repo

Trade-off:

* This is intentionally lightweight for the MVP
* It still provides a trustworthy actor source for auditability
* Production would replace this with SSO and RBAC

### Webhook Signature Verification

Webhook HMAC verification must use the raw request body.

Rules:

* Do not verify against parsed JSON re-serialized with `JSON.stringify`
* Preserve the raw request body in Express before JSON parsing mutates the payload
* Verify the HMAC against the exact received bytes

Trade-off:

* This adds a small amount of request parsing complexity
* It avoids false signature mismatches caused by JSON normalization differences

### API Key Storage And Verification

Customer API keys are high-entropy secrets and must never be stored in plaintext.

Rules:

* Persist `key_prefix` for display and debugging
* Persist `key_hash` only
* Compute `key_hash` with `HMAC-SHA256(api_key_pepper, raw_token)`
* Load `api_key_pepper` from the environment
* Do not commit the pepper to the repo

Trade-off:

* This is simple and fast for high-entropy tokens
* It is appropriate here because API keys are generated secrets, not human passwords

### Audit Log Immutability

Audit logs are append-only financial audit records.

Rules:

* The MVP does not expose update or delete application paths for `audit_logs`
* `audit_logs` must capture actor, timestamp, reason, and before/after values where applicable
* `DESIGN.md` must state that production would enforce append-only behavior at the database permission or trigger level

Trade-off:

* The MVP enforces immutability primarily through application behavior
* Production should enforce it at the database layer as well

### Paid Invoice Mutation Rule

Paid invoices must not be directly mutated by line-item override.

Rules:

* `draft` and `issued` invoices may allow line-item override
* `paid` invoices must reject direct override
* Corrections for paid invoices should be represented through credit or correction flows, not silent mutation

Trade-off:

* This adds a branch in the ops workflow
* It preserves the integrity of finalized financial records

### Credit Scope Rule

MVP credits must be tied to an invoice.

Rules:

* `invoice_id` is required for `POST /ops/customers/:id/credits`
* Credit issuance updates the associated invoice totals transactionally
* Future account-level credits are explicitly out of scope for the MVP

Trade-off:

* This keeps the credit flow and invoice recalculation easy to reason about
* It avoids introducing an account-balance system into the take-home

### Rounding Policy

Sub-cent pricing uses integer micros during calculation, then converts to cents deterministically.

Rules:

* Pricing calculations use integer micros
* Stored invoice and line-item totals use integer cents
* The rounding policy is `half-up` when converting aggregated micros to cents
* The same rounding policy must be used consistently in invoice generation, recalculation, and tests

Trade-off:

* This avoids floating-point errors
* A fixed rounding policy prevents one-cent drift across code paths

### Job Locking Strategy

Background jobs must use a concrete locking strategy.

Rules:

* Use Postgres advisory locks for MVP job exclusion
* Aggregation and invoice-generation jobs each get a stable lock key
* If the lock cannot be acquired, the duplicate job run exits safely
* `job_runs` still records execution attempts and outcomes

Trade-off:

* Advisory locks are simple and fit a single-database MVP well
* They provide a clear concurrency story without adding external infrastructure

### Anomaly Signal Definition

The anomaly signal is an ops hint only and does not affect billing.

Rules:

* Define anomaly as `current_hour_units > 10x average_hourly_units_last_30_days`
* Surface it in the ops experience only
* Do not let anomaly status modify billing calculations or invoice state

Trade-off:

* This is intentionally simple
* It provides useful operational signal without complicating correctness logic

## MVP Scope Guardrails

Must-have:

* Docker Compose local setup
* Real relational database
* Seed data and usage generator
* Batched event ingestion
* Idempotent `request_id` handling
* Hourly aggregation
* Monthly invoices with tiered pricing
* Customer usage and invoice APIs
* Ops customer, credit, and line-item override APIs
* Signed payment webhook with replay protection
* Customer dashboard
* Ops console
* Correctness-focused tests
* `DESIGN.md`

Do not build unless explicitly needed:

* Real Stripe integration
* Kafka
* Kubernetes
* AWS deployment
* Multi-currency
* Taxes
* PDF invoices
* Email delivery
* Full auth system
* Complex RBAC

## Task Breakdown

### Phase 0: Planning Baseline

- [ ] Keep this document current as implementation decisions change
- [ ] Move pagination into MVP, not optional scope
- [ ] Move late-event lookback recomputation into MVP, not optional scope
- [ ] Keep `GET /v1/usage` contract fixed unless a later change is intentional
- [ ] Keep ops auth fixed as `X-Ops-Token` + `X-Ops-Actor`
- [ ] Keep webhook verification fixed to raw-body HMAC
- [ ] Keep API key verification fixed to HMAC-SHA256 with env-loaded pepper
- [ ] Keep paid-invoice override rules fixed
- [ ] Keep credit scope fixed to invoice-bound credits in the MVP
- [ ] Keep micros-to-cents rounding policy fixed across all code paths
- [ ] Keep job locking fixed to Postgres advisory locks
- [ ] Keep anomaly logic fixed to an ops-only hint

### Phase 1: Repo And Runtime Foundation

- [ ] Confirm monorepo structure
- [ ] Add backend app directory
- [ ] Keep existing Vite frontend in the workspace
- [ ] Create root workspace scripts
- [ ] Add `docker-compose.yml`
- [ ] Add Postgres service
- [ ] Choose and wire a migration tool
- [ ] Add `.env.example`
- [ ] Include `DATABASE_URL`
- [ ] Include `OPS_SHARED_SECRET`
- [ ] Include payment webhook secret
- [ ] Include API key pepper secret
- [ ] Update README with startup steps
- [ ] Define root commands for `test`, `lint`, `typecheck`, and local dev

### Phase 2: Database Schema

- [ ] Create `customers`
- [ ] Create `api_keys`
- [ ] Store `key_prefix`
- [ ] Store `key_hash`
- [ ] Support `revoked_at`
- [ ] Create `price_plans`
- [ ] Create `price_tiers`
- [ ] Create `usage_events`
- [ ] Enforce `unique(request_id)`
- [ ] Create `usage_windows`
- [ ] Enforce `unique(customer_id, window_start)`
- [ ] Create `invoices`
- [ ] Enforce `unique(customer_id, period_start, period_end)`
- [ ] Create `invoice_line_items`
- [ ] Store override metadata needed for auditability if not derived elsewhere
- [ ] Create `credits`
- [ ] Enforce `unique(customer_id, idempotency_key)`
- [ ] Require `invoice_id` on credits in the MVP schema
- [ ] Create `webhook_deliveries`
- [ ] Enforce `unique(provider_event_id)`
- [ ] Create `audit_logs`
- [ ] Create `job_runs`
- [ ] Add index on `usage_events(customer_id, occurred_at)`
- [ ] Add index on `usage_events(api_key_id, occurred_at)`
- [ ] Add index on `usage_windows(customer_id, window_start)`
- [ ] Add index on `invoices(customer_id, period_start)`
- [ ] Add index on `audit_logs(entity_type, entity_id, created_at)`

### Phase 3: Seed And Demo Data

- [ ] Seed price plans and tiers
- [ ] Seed customers
- [ ] Seed API keys
- [ ] Only persist hashed API keys
- [ ] Print demo values once for local use
- [ ] Seed usage events across multiple days and hours
- [ ] Seed invoices in different statuses
- [ ] Seed example credits
- [ ] Seed example audit logs if useful for UI
- [ ] Add usage-event generator script
- [ ] Make generator configurable

### Phase 4: Auth And Request Context

- [ ] Implement customer API key auth middleware
- [ ] Compute `HMAC-SHA256(api_key_pepper, bearer_token)` and compare against `api_keys.key_hash`
- [ ] Reject revoked API keys
- [ ] Attach customer context to request
- [ ] Implement ops auth middleware
- [ ] Validate `X-Ops-Token` against `OPS_SHARED_SECRET`
- [ ] Read `X-Ops-Actor`
- [ ] Reject money-moving ops requests without actor
- [ ] Centralize tenant-scoped data access
- [ ] Avoid route-by-route tenant filters as the primary safety mechanism

### Phase 5: Event Ingestion API

- [ ] Build `POST /v1/events`
- [ ] Accept batched payloads
- [ ] Validate request schema
- [ ] Validate `api_key_id` belongs to authenticated customer
- [ ] Insert with `ON CONFLICT DO NOTHING`
- [ ] Return `accepted` and `duplicates`
- [ ] Accept late and out-of-order timestamps
- [ ] Reject invalid `units`
- [ ] Test duplicate `request_id`
- [ ] Test concurrent duplicate ingestion
- [ ] Test cross-customer `api_key_id` rejection

### Phase 6: Usage Aggregation Job

- [ ] Build hourly aggregation job
- [ ] Aggregate by `customer_id x hour`
- [ ] Recompute from raw `usage_events`, not incremental `+=`
- [ ] Upsert `usage_windows.total_units`
- [ ] Add Postgres advisory-lock job exclusion
- [ ] Record job runs
- [ ] Implement lookback recomputation for late events
- [ ] Decide and document lookback window
- [ ] Do not silently lose late-arriving events
- [ ] Test rerun idempotency
- [ ] Test late-event recomputation
- [ ] Test concurrent job safety

### Phase 7: Usage Read API

- [ ] Build `GET /v1/usage`
- [ ] Support `start`
- [ ] Support `end`
- [ ] Support `api_key_id`
- [ ] Support `granularity`
- [ ] Support `limit`
- [ ] Support `cursor`
- [ ] Default to hourly buckets
- [ ] Read from `usage_windows` when no `api_key_id` filter is present
- [ ] Aggregate hourly windows into daily totals when `granularity=day`
- [ ] Aggregate directly from `usage_events` when `api_key_id` is provided
- [ ] Keep one consistent response shape for all query paths
- [ ] Implement cursor pagination
- [ ] Validate invalid date ranges and cursors
- [ ] Test tenant isolation
- [ ] Test default hourly behavior
- [ ] Test daily aggregation behavior
- [ ] Test `api_key_id` path
- [ ] Test pagination behavior

### Phase 8: Invoice Generation

- [ ] Build monthly invoice job
- [ ] Sum billing-period usage from `usage_windows`
- [ ] Implement tiered pricing
- [ ] Use integer micros for sub-cent unit prices
- [ ] Store invoice totals in integer cents
- [ ] Apply `half-up` rounding when converting micros to cents
- [ ] Create invoice and line items in a transaction
- [ ] Keep invoice generation idempotent
- [ ] Decide rerun behavior for draft invoices
- [ ] Do not silently mutate issued or paid invoices
- [ ] Test pricing math
- [ ] Test invoice rerun idempotency
- [ ] Test late events before issuance
- [ ] Test no silent mutation after issuance

### Phase 9: Customer Invoice APIs

- [ ] Build `GET /v1/invoices`
- [ ] Add pagination
- [ ] Build `GET /v1/invoices/:id`
- [ ] Enforce tenant scoping in the data-access layer
- [ ] Return 404 for cross-tenant access attempts
- [ ] Include line items
- [ ] Include credits
- [ ] Include totals and status
- [ ] Test invoice list and detail access

### Phase 10: Payment Webhook

- [ ] Build `POST /webhooks/payments`
- [ ] Preserve the raw request body in Express
- [ ] Verify webhook signature against the raw body
- [ ] Load webhook secret from env
- [ ] Insert `webhook_deliveries` before applying effects
- [ ] Deduplicate on `provider_event_id`
- [ ] Mark invoice paid transactionally
- [ ] Make replay a no-op success
- [ ] Reject invalid signatures
- [ ] Test replay safety
- [ ] Test invalid signature rejection
- [ ] Test concurrent replay safety

### Phase 11: Ops Read APIs

- [ ] Build `GET /ops/customers`
- [ ] Add pagination
- [ ] Build `GET /ops/customers/:id`
- [ ] Return customer summary data
- [ ] Return usage summary data
- [ ] Return invoice summary data
- [ ] Return audit trail data
- [ ] Add anomaly signal using `current_hour_units > 10x average_hourly_units_last_30_days`
- [ ] Keep anomaly as an ops hint only
- [ ] Test ops auth checks

### Phase 12: Credits

- [ ] Build `POST /ops/customers/:id/credits`
- [ ] Require `invoice_id`
- [ ] Require amount
- [ ] Require reason
- [ ] Require idempotency key
- [ ] Require `X-Ops-Actor`
- [ ] Insert credit transactionally
- [ ] Update invoice totals transactionally
- [ ] Write audit log transactionally
- [ ] Keep duplicate idempotency key safe
- [ ] Decide whether duplicate requests return existing result or no-op success
- [ ] Test missing actor rejection
- [ ] Test missing reason rejection
- [ ] Test duplicate idempotency safety
- [ ] Test invoice total recalculation
- [ ] Test audit-log creation

### Phase 13: Line-Item Overrides

- [ ] Build `PATCH /ops/invoices/:invoiceId/line-items/:lineItemId`
- [ ] Require override reason
- [ ] Require `X-Ops-Actor`
- [ ] Allow override for `draft` and `issued` invoices only
- [ ] Reject direct override for `paid` invoices
- [ ] Lock invoice or affected rows before mutation
- [ ] Capture before snapshot
- [ ] Apply override
- [ ] Mark `is_overridden=true`
- [ ] Recalculate invoice totals
- [ ] Write immutable audit log entry
- [ ] Test missing actor rejection
- [ ] Test audit trail completeness
- [ ] Test total recalculation
- [ ] Test invalid line-item safety

### Phase 14: Customer Frontend

- [ ] Add demo customer API key input flow
- [ ] Show current-period usage
- [ ] Show usage chart
- [ ] Support hourly and daily display
- [ ] Support date range filters
- [ ] Show invoice list
- [ ] Show invoice detail
- [ ] Handle loading states
- [ ] Handle empty states
- [ ] Handle error states

### Phase 15: Ops Frontend

- [ ] Add ops token input flow
- [ ] Add ops actor input flow
- [ ] Show customer list
- [ ] Show customer detail
- [ ] Show usage summary
- [ ] Show invoices
- [ ] Show audit trail
- [ ] Build credit form
- [ ] Build line-item override form
- [ ] Show before and after totals for money-moving actions
- [ ] Require reason in UI
- [ ] Add confirmation step
- [ ] Handle loading and error states

### Phase 16: `DESIGN.md`

- [ ] Write overview
- [ ] Document schema and indexes
- [ ] Document idempotency strategy
- [ ] Document concurrency strategy
- [ ] Document aggregation pipeline
- [ ] Document late-arriving event handling
- [ ] Document `GET /v1/usage` trade-off
- [ ] Document ops auth trade-off
- [ ] Document raw-body webhook verification
- [ ] Document API key storage and verification with peppered HMAC
- [ ] Document audit log immutability model
- [ ] Document paid-invoice override rule
- [ ] Document invoice-bound credit rule
- [ ] Document rounding policy
- [ ] Document advisory-lock job strategy
- [ ] Document anomaly signal definition as an ops-only hint
- [ ] Document threat model
- [ ] Document failure modes
- [ ] Document 10x scaling path
- [ ] Document 100x scaling path
- [ ] Document what was intentionally not built

### Phase 17: Verification And Submission

- [ ] Run migrations from scratch
- [ ] Run seed flow from scratch
- [ ] Run backend tests
- [ ] Run frontend build
- [ ] Run lint and typecheck
- [ ] Walk full happy path locally
- [ ] Test ingest -> aggregate -> usage read -> invoice -> credit -> override -> webhook replay
- [ ] Run `docker compose up`
- [ ] Finalize README setup notes
- [ ] Finalize submission checklist

## Suggested Daily Progress Log Format

Use this format to keep implementation notes concise and useful:

### Date

#### Planned

* What phase(s) you intend to complete

#### Completed

* What was implemented
* What was verified

#### Open Issues

* What is blocked
* What trade-off or design decision remains open

#### Next

* The next smallest meaningful step

## Immediate Next Step

Start with Phase 1 and Phase 2 together:

* Lock the repo structure
* Choose backend stack details
* Add Docker and Postgres
* Create the first migration set for the core tables
