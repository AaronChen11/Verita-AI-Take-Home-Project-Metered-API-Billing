# Metered API Billing Design

## Overview

This project is a correctness-first metered API billing MVP for a SaaS API. The core path is:

1. A customer authenticates with a high-entropy API key.
2. The product emits batched usage events into `POST /v1/events`.
3. A scheduled aggregation job recomputes hourly usage windows from raw events.
4. A scheduled invoice job prices monthly usage windows into invoice line items.
5. Customers read usage and invoices through tenant-scoped APIs.
6. Ops users inspect customer state, issue credits, override eligible line items, and review anomaly hints.
7. A signed payment webhook marks invoices paid with replay protection.

The system favors recomputation, database constraints, scoped repositories, and auditable financial mutations over premature distributed infrastructure.

## Data Model

The database is Postgres. Money is stored in integer cents, and usage pricing uses integer `unit_price_micros` to avoid floating-point billing errors. A second migration upgrades unit counters and money columns from `integer` to `bigint`; at 500M events/month and multi-unit events, 32-bit integers could overflow within months, while `bigint` moves the ceiling to about 9.2e18.

Core tables:

* `price_plans`, `price_tiers`: tiered pricing configuration.
* `customers`: tenant record and active price plan.
* `api_keys`: API key metadata, prefix, HMAC hash, and revocation timestamp.
* `usage_events`: immutable raw product events with globally unique `request_id`.
* `usage_windows`: derived hourly totals, one row per `customer_id x window_start`.
* `invoices`: monthly invoice headers with `subtotal_cents`, `credits_cents`, and `total_cents`.
* `invoice_line_items`: priced usage lines plus override metadata.
* `credits`: invoice-bound corrections with idempotency keys.
* `webhook_deliveries`: payment webhook replay records.
* `audit_logs`: append-only application audit trail for ops financial actions.
* `job_runs`: scheduled-job observability records.

Important constraints are part of the correctness model:

* `usage_events.request_id` is unique, so usage ingestion retries cannot double-bill.
* `usage_windows(customer_id, window_start)` is unique, so aggregation can upsert deterministic hourly totals.
* `invoices(customer_id, period_start, period_end)` is unique, so invoice generation is rerunnable.
* `credits(customer_id, idempotency_key)` is unique, so repeated credit submissions do not double-apply.
* `webhook_deliveries.provider_event_id` is unique, so webhook replays become no-ops.

Indexes match the main access patterns: active API key hash lookup, usage events by customer/time and occurred time, usage windows by customer/window, invoice pagination by customer and created time, invoice line items by invoice, credits by invoice, and webhook deliveries by provider event ID. The high-frequency API key lookup uses a partial index on `(key_hash) WHERE revoked_at IS NULL`, keeping revoked keys out of the hot auth index.

At 10x scale I would partition `usage_events` by time, keep local indexes on partitions, and add `usage_windows_by_api_key(customer_id, api_key_id, window_start)` for filtered usage reads. At 100x scale I would keep Postgres as the financial source of truth, but move ingestion buffering to a durable queue and process aggregation by partitioned customer/time shards.

## Auth, Secrets, And Tenant Isolation

Customer API keys are generated high-entropy tokens. The raw token is shown only once. The database stores:

```text
key_hash = HMAC-SHA256(API_KEY_PEPPER, raw_token)
```

`API_KEY_PEPPER` comes from env and is not committed. HMAC-SHA256 is used instead of bcrypt because these are server-generated high-entropy secrets, not user passwords; fast deterministic lookup is appropriate.

Customer auth middleware verifies the bearer token, rejects revoked keys, and attaches `{ customerId, apiKeyId }` to the request. Tenant scoping lives in repositories rather than view code. For example, invoice detail reads by both authenticated `customer_id` and requested `invoice_id`; a cross-tenant guess returns `404`.

Ops auth is intentionally lightweight for the take-home. `/ops` routes require `X-Ops-Token`, checked against `OPS_SHARED_SECRET`. Money-moving ops actions also require `X-Ops-Actor`, which is written into credits, overrides, and audit logs. Production should replace this with SSO/RBAC, but the MVP still has an attributable actor source.

Webhook secrets, API key pepper, DB URL, and ops secret are env-based. No secrets belong in the repo.

## Ingestion, Idempotency, And Concurrency

`POST /v1/events` accepts batched events containing `request_id`, `api_key_id`, `endpoint`, `units`, and `timestamp`. The route validates shape and units, then verifies every supplied `api_key_id` belongs to the authenticated customer before insert.

The route also accepts an injected rate-limiter middleware. The local MVP keeps it lightweight, but the hook is there so production can throttle abusive customers before expensive validation or inserts.

The insert uses:

```sql
ON CONFLICT (request_id) DO NOTHING
```

That makes retries and concurrent duplicate delivery safe. The first insert wins; later copies are counted as duplicates and do not affect billing. A real Postgres integration test proves this unique constraint behavior against the actual database, not only mocks.

Ops money-moving flows are also transactionally guarded:

* Credit issuance locks the target invoice, inserts with unique `(customer_id, idempotency_key)`, recalculates totals, writes audit, and commits.
* Duplicate credit requests return the original credit result without writing a second credit or audit row.
* Line-item override locks the invoice and line item, rejects paid invoices, recalculates totals from all line items and credits, writes audit, and commits.
* Payment webhook handling inserts `webhook_deliveries` first; duplicate provider event IDs return successful no-op responses.

Scheduled jobs use Postgres advisory locks. If two aggregators or invoice generators start at the same time, only one performs work. Unique constraints remain the final correctness backstop if a process crashes or retries.

## Aggregation Pipeline

Raw `usage_events` are the source of truth. `usage_windows` is derived state.

The aggregation job recomputes a lookback range, currently defaulting to 48 hours. It groups events by customer and hour using `occurred_at`, then upserts each window by replacing `total_units` with the recomputed value rather than incrementing. This makes repeated runs deterministic: same raw events, same windows. `received_at` is stored separately for ingestion-delay monitoring and late-event diagnostics.

`GET /v1/usage` defaults to hourly buckets backed by `usage_windows`. It accepts `start`, `end`, `api_key_id`, `granularity`, `limit`, and `cursor`, with a 90-day maximum range guard to avoid accidental broad scans before partitioning. Day granularity aggregates hourly windows into daily totals. Because `usage_windows` is currently `customer x hour`, the MVP handles `api_key_id` filtering by aggregating directly from `usage_events`; this is correct but less scalable. The planned scale path is `usage_windows_by_api_key`.

Late and out-of-order events are accepted. If they arrive inside the aggregation lookback, the next job recomputes the affected windows. If they arrive after a draft invoice was generated, the invoice can be regenerated or reconciled before issue. If they arrive after an invoice is issued or paid, the system should not silently mutate the financial record; production would create an explicit correction line, credit, or adjustment invoice tied to the late usage delta. The MVP documents this policy and already uses credits instead of mutating paid invoices.

`job_runs` records job attempts, status, range, and metadata. This supports debugging stale usage windows, failed invoice generation, and alerting on missed scheduled runs.

## Invoice Generation And Financial Mutations

Invoice generation reads `usage_windows` for a billing period and applies the customer's tiered price plan. Unit prices are stored in micros and converted to cents with deterministic half-up rounding. This avoids "off by one cent" drift between runs.

Invoices are monthly. The generator creates line items from usage and uses the unique `(customer_id, period_start, period_end)` constraint for idempotency. Reruns skip existing invoices rather than mutating issued or paid records. Invoice `total_cents` is computed as `GREATEST(subtotal_cents - credits_cents, 0)`, so large credits reduce an invoice to zero instead of creating a negative invoice balance.

Credits are invoice-bound in the MVP. That is simpler than an account-level credit ledger because every credit has one visible target invoice and one recalculated total. Credit amounts must be positive, so credits only reduce invoices; they cannot be misused as surcharge rows. Account-level balances, carry-forward rules, and statement reconciliation are deferred.

Line-item overrides are allowed for `draft` and `issued` invoices. Paid invoices reject direct mutation; post-payment corrections must use credits or a future correction flow. `void` invoices are unavailable for override or payment updates. This prevents silent mutation of finalized or canceled financial records.

Audit rows capture actor, action, entity type, entity ID, reason, before/after values, and timestamp. The application exposes no update/delete path for `audit_logs`. In production I would enforce append-only behavior with a DB role that only has `INSERT/SELECT` on `audit_logs`, or triggers that reject `UPDATE` and `DELETE`.

## Payment Webhook

`POST /webhooks/payments` is a local payment-processor contract for the exercise. It uses `express.raw()` and verifies `X-Payment-Signature` against the exact raw request body with `PAYMENT_WEBHOOK_SECRET`. It does not parse JSON and then re-stringify for verification, because that can change bytes and break signatures.

After signature verification, the handler inserts a `webhook_deliveries` row. If the `provider_event_id` already exists, the request is treated as a replay and returns success without reapplying effects. Otherwise, the invoice is marked paid transactionally.

The MVP does not integrate directly with Stripe. In production I would also verify provider timestamps and reject stale signed payloads.

## Testing And Correctness Evidence

The test suite focuses on correctness boundaries rather than trivial coverage:

* Usage event dedupe and route-level validation.
* Customer tenant isolation for invoice and usage reads.
* Payment webhook raw-body signature verification and replay behavior.
* Credit idempotency, rollback behavior, and audit writes.
* Line-item override rules, including paid invoice rejection.
* Aggregation and invoice job idempotency.
* Pricing and rounding.

There is also a real Postgres integration test for behavior mocks cannot prove: `request_id` uniqueness under the actual constraint, `jsonb_agg` shape mapping into TypeScript, and the credit transaction updating invoice totals plus audit rows. Frontend tests cover API header boundaries, local credential storage, axe accessibility smoke checks, and coverage reporting.

## Threat Model

Hostile customer: The main risk is cross-tenant data access or usage misattribution. A customer may guess another invoice ID or submit events with another customer's `api_key_id`. Repository-level tenant filters prevent cross-tenant reads, and ingestion verifies API key ownership before insert. UUID secrecy is not the security boundary.

Hostile internal user: The main risk is invoice tampering or excessive credits. Ops mutations require an actor, reason, audit log, and transactionally recalculated totals. Paid invoices cannot be directly overridden. The MVP does not prevent a fully authorized ops user from issuing many credits with different idempotency keys; production RBAC, approval workflows, credit limits, and actor-based alerts would reduce that risk.

Compromised webhook source: The main risk is marking invoices paid without real payment. HMAC verification over raw body blocks unsigned forgery, and `webhook_deliveries.provider_event_id` blocks replay. A leaked webhook secret remains serious; production should rotate secrets, verify timestamps, and monitor signature failures.

Credential leakage: Raw API keys are not stored after creation. If a customer key leaks, the blast radius is that customer's API access until revocation. If `API_KEY_PEPPER` leaks, key hashes become easier to verify offline, so rotation and customer key reissue are required.

## Failure Modes And Scaling Path

1. Aggregation scans become too slow. At 200 events/sec, a 48-hour lookback is about 34.5M events. The fix is monthly or daily partitioning, shorter frequent lookbacks, and a slower reconciliation job for late events.

2. API-key-filtered usage reads hit raw events. This is correct for MVP but will degrade for long ranges. The fix is `usage_windows_by_api_key`.

3. Invoice generation becomes too large as customer count grows. The fix is customer batching with resumable job state; uniqueness constraints and bigint totals keep partial reruns and high-volume counters safe.

4. Ops audit queries fan out over too much invoice history. The fix is denormalizing `customer_id` onto `audit_logs` and indexing `(customer_id, created_at DESC)`.

Operational alerts should cover stale aggregation, failed invoice generation, webhook signature spikes, anomaly spikes across many customers, credit volume by actor, and paid invoices with suspiciously low totals. The anomaly signal compares the current UTC-hour `usage_windows.total_units` against the trailing 30-day per-hour average from `usage_windows`; it flags when the current hour exceeds 10x that average.

## Trade-offs

Recompute windows vs. incremental counters: I chose recomputation because it is idempotent by construction. Incremental counters are faster per event but require exactly-once delivery or a stronger dedupe layer.

Invoice-bound credits vs. account-level ledger: I chose invoice-bound credits because they are simpler to audit and recalculate. A general ledger is more flexible but adds carry-forward and reconciliation complexity beyond the MVP.

Shared ops token vs. SSO/RBAC: I chose lightweight ops auth to spend effort on billing correctness. It is not production auth; SSO/RBAC is the clear replacement.

Postgres advisory locks vs. external job system: I chose advisory locks because one database already owns the correctness constraints. A queue or worker system is useful later, but it does not remove the need for database idempotency.

Keyset pagination vs. offset: usage buckets, invoices, and ops customer lists use cursor-based pagination rather than `OFFSET`. Offset scans and discards rows, degrades with page depth, and can produce inconsistent pages under concurrent inserts. Time-plus-UUID or bucket-time cursors stay stable and index-friendly.

## Not Built Next

Intentionally not built: real Stripe integration, taxes, multi-currency, PDF invoices, email delivery, account-level credit balances, full SSO/RBAC, Kafka, and a full late-event reconciliation ledger.

Next production steps would be: partition usage events, add API-key usage rollups, add webhook timestamp freshness, enforce audit immutability at the DB permission layer, add RBAC approval limits for credits, and build explicit correction invoices for late post-issue usage.
