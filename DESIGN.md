# Metered API Billing Design

## Overview

This project is a correctness-first metered API billing MVP. The core flow is:

1. Customers authenticate with high-entropy API keys.
2. Customers send batched usage events to `POST /v1/events`.
3. A background job recomputes hourly usage windows from immutable raw events.
4. Monthly invoice generation prices usage with tiered pricing and deterministic rounding.
5. Customers read usage and invoices through tenant-scoped APIs.
6. Ops users inspect customer state, issue invoice-bound credits, and override draft or issued line items with audit logs.
7. A signed payment webhook marks invoices paid with replay protection.

The design optimizes for idempotency, recomputation, tenant isolation, and auditable financial mutations over infrastructure complexity.

## Schema

The database is Postgres and the schema is defined in `backend/src/db/migrations/000001_initial_schema.cjs`.

Core tables:

* `price_plans` and `price_tiers`: tiered pricing configuration using integer `unit_price_micros`.
* `customers`: tenant record with a linked price plan.
* `api_keys`: stores `key_prefix`, `key_hash`, and `revoked_at`; never stores raw API keys.
* `usage_events`: immutable raw usage events with globally unique `request_id`.
* `usage_windows`: derived hourly usage, one row per `customer_id x window_start`.
* `invoices`: monthly invoice header with `subtotal_cents`, `credits_cents`, and `total_cents`.
* `invoice_line_items`: invoice pricing lines and override metadata.
* `credits`: invoice-bound credits with unique `(customer_id, idempotency_key)`.
* `webhook_deliveries`: payment webhook replay protection with unique `provider_event_id`.
* `audit_logs`: append-only application audit records for ops financial actions.
* `job_runs`: records aggregation job attempts, outcomes, and metadata.

Key constraints and indexes:

* `usage_events.request_id` is unique for ingestion idempotency.
* `usage_windows(customer_id, window_start)` is unique for recomputable hourly windows.
* `invoices(customer_id, period_start, period_end)` is unique for invoice generation idempotency.
* `credits(customer_id, idempotency_key)` is unique for credit retry safety.
* `webhook_deliveries.provider_event_id` is unique for webhook replay safety.
* Read paths are supported by indexes on usage event time ranges, usage windows, invoices, active API key hashes, invoice line items, credits, and audit entities.

## Auth And Tenant Isolation

Customer API keys are generated high-entropy tokens. The raw token is only shown once, and the database stores:

* `key_prefix` for display/debugging.
* `key_hash = HMAC-SHA256(API_KEY_PEPPER, raw_token)`.

The customer auth middleware hashes the bearer token with the env-loaded pepper, compares using a DB lookup, rejects revoked keys, and attaches `{ customerId, apiKeyId }` to the request. Customer-facing repositories scope reads and writes by `customer_id`, not by trusting caller-provided customer IDs.

Ops auth is intentionally lightweight for the take-home:

* `/ops` routes require `X-Ops-Token`.
* The token is compared against `OPS_SHARED_SECRET`.
* Money-moving actions also require `X-Ops-Actor`.
* `X-Ops-Actor` is stored in `credits.created_by`, `invoice_line_items.overridden_by`, and `audit_logs.actor`.

Production should replace this with SSO and RBAC, but the MVP still has a trustworthy actor source for auditability.

## Usage Ingestion

`POST /v1/events` accepts batched usage events:

* `request_id`
* `api_key_id`
* `endpoint`
* `units`
* `timestamp`

The route validates payload shape, rejects invalid units, and verifies that every supplied `api_key_id` belongs to the authenticated customer. The repository inserts events with `ON CONFLICT (request_id) DO NOTHING`, so retries are safe and duplicate events are reported without failing the request.

Late and out-of-order events are accepted. They become visible in billing windows when the aggregation job recomputes the affected lookback range.

## Aggregation Pipeline

Raw events are the source of truth. `usage_windows` is derived state.

The aggregation job:

* Uses a default 48-hour lookback.
* Recomputes hourly windows from `usage_events`.
* Upserts into `usage_windows`.
* Replaces `total_units` with recomputed totals instead of incrementing.
* Uses a Postgres advisory lock so duplicate job runs safely skip.

This avoids double-counting on retries and supports late-arriving events inside the lookback window.

## Usage Read API

`GET /v1/usage` supports:

* `start`
* `end`
* `api_key_id`
* `granularity`
* `limit`
* `cursor`

Default `granularity` is `hour`.
`start` and `end` are required so reads stay bounded and pagination has a stable range.

Default path:

* Reads hourly buckets from `usage_windows`.

Daily path:

* Aggregates hourly windows into daily totals.

`api_key_id` filter path:

* Aggregates directly from `usage_events`.

Trade-off: `usage_windows` is currently `customer x hour`, not `customer x api_key x hour`. For the MVP, the API key filter is correct but less scalable because it reads raw events. At higher scale, add a `usage_windows_by_api_key` rollup table.

## Invoice Generation

Invoice generation reads customer usage from `usage_windows` for a billing period and applies the customer's price tiers.

Pricing rules:

* Unit prices use integer micros.
* Stored amounts use integer cents.
* Micros-to-cents conversion uses deterministic half-up rounding.
* Floating-point arithmetic is avoided for billable money values.

Idempotency:

* `invoices(customer_id, period_start, period_end)` is unique.
* Invoice creation uses `ON CONFLICT DO NOTHING`.
* Reruns skip existing invoices rather than mutating issued or paid financial records.

Concurrency:

* Invoice generation uses a Postgres advisory lock.
* The uniqueness constraint is the final correctness guard.

## Customer Invoice APIs

Customer invoice APIs:

* `GET /v1/invoices`
* `GET /v1/invoices/:id`

Reads are scoped by authenticated `customer_id` inside repository methods. Cross-tenant invoice IDs return `404`, avoiding invoice existence leakage.

Invoice list pagination uses a composite cursor of `(created_at, id)` to match `ORDER BY created_at DESC, id DESC`, avoiding skipped or duplicated rows when timestamps tie.

Invoice detail returns:

* Invoice summary fields.
* Line items.
* Credits.

## Credits

Credits are invoice-bound in the MVP.

`POST /ops/customers/:id/credits` requires:

* `invoice_id`
* `amount_cents`
* `reason`
* `idempotency_key`
* `X-Ops-Actor`

The repository transaction:

1. Locks the target invoice for the customer.
2. Inserts the credit with `ON CONFLICT (customer_id, idempotency_key) DO NOTHING`.
3. Recalculates invoice `credits_cents` and `total_cents`.
4. Writes an audit log with before and after invoice totals.
5. Commits.

Duplicate idempotency keys return the existing credit and its invoice totals without writing another credit or audit log.

Future account-level credit balances are intentionally out of scope.

## Line-Item Overrides

`PATCH /ops/invoices/:invoiceId/line-items/:lineItemId` requires:

* `amount_cents`
* `reason`
* `X-Ops-Actor`

Rules:

* `draft` and `issued` invoices may be overridden.
* `paid` invoices reject direct overrides.
* `void` invoices are treated as unavailable for override.
* Paid invoice corrections should use credits or a future correction flow.

The repository transaction:

1. Locks the invoice.
2. Rejects paid invoices.
3. Locks the line item.
4. Updates `amount_cents`, `is_overridden`, `overridden_at`, `override_reason`, and `overridden_by`.
5. Recalculates invoice totals from all line items and existing credits.
6. Writes an audit log with before and after snapshots.
7. Commits.

This prevents silent mutation of finalized financial records.

## Payment Webhook

`POST /webhooks/payments` is a local payment webhook contract for the take-home.

Rules:

* Uses `express.raw()` before global JSON parsing.
* Verifies `X-Payment-Signature` against the exact raw request body.
* Does not verify against parsed JSON re-serialized with `JSON.stringify`.
* Loads `PAYMENT_WEBHOOK_SECRET` from env.
* Inserts a `webhook_deliveries` row before applying effects.
* Deduplicates with unique `provider_event_id`.
* Marks invoice paid transactionally.
* Duplicate webhook events return no-op success.

The MVP does not integrate with Stripe directly.

## Audit Log Immutability

The MVP does not expose application update or delete paths for `audit_logs`.

Audit records capture:

* Actor.
* Action.
* Entity type and entity ID.
* Reason.
* Before and after values where applicable.
* Created timestamp.

Production should enforce append-only behavior at the database layer as well, either by using an application DB role with only `INSERT/SELECT` permissions on `audit_logs`, or by adding triggers that reject `UPDATE` and `DELETE`.

## Anomaly Signal

Ops detail includes a simple anomaly hint:

```text
current_hour_units > 10x average_hourly_units_last_30_days
```

This is read-only and ops-only. It does not affect billing, usage windows, invoices, credits, or customer-visible state.

## Trade-offs

### Recompute-and-replace vs. delta accumulation for usage windows

Chosen: full recomputation of `usage_windows` from raw `usage_events` on each aggregation run.

Rejected: incrementally accumulating deltas, such as a streaming consumer updating a counter per event.

Why: recomputation is idempotent by construction. Running the same job twice produces the same `total_units` for each customer-hour bucket. Delta accumulation needs exactly-once delivery or a consumer-side deduplication layer to avoid double-counting. Since billing accuracy is contractual, the simpler correctness model is worth the lookback scan cost at MVP scale.

Trade-off: recomputation scans more rows than an incremental counter update. The scaling path is time partitioning plus narrower scheduled lookbacks, while keeping a longer reconciliation pass for late events.

### HMAC-SHA256 vs. bcrypt for API key storage

Chosen: `HMAC-SHA256(API_KEY_PEPPER, raw_token)`.

Rejected: password hash functions such as bcrypt or scrypt.

Why: bcrypt is designed for user-chosen, low-entropy passwords where offline dictionary attacks are realistic. API keys here are generated high-entropy secrets, so the keyspace is too large for brute force regardless of hash speed. HMAC-SHA256 gives fast lookup at auth time and is the right primitive for server-generated tokens.

Trade-off: if the pepper leaks, an attacker can verify guesses quickly. The mitigation is operational: keep `API_KEY_PEPPER` in env or a secret manager, do not store it in the database, and rotate keys if it is exposed.

### Invoice-bound credits vs. account-level credit balance

Chosen: each credit must reference a specific `invoice_id`.

Rejected: a general account-level credit ledger that rolls balances across billing periods.

Why: invoice-bound credits are easier to audit and reconcile. Every credit has a visible effect on exactly one invoice, and the before/after invoice totals are captured in `audit_logs`. An account-level balance requires additional ledger semantics, carry-forward rules, and reconciliation UI that are outside the MVP.

Trade-off: credits do not automatically carry forward to future invoices. Ops must apply corrections to a specific invoice in the MVP; a production system could add an account-level ledger later.

### Lightweight ops auth vs. full SSO/RBAC

Chosen: `X-Ops-Token` checked against `OPS_SHARED_SECRET`, plus `X-Ops-Actor` for money-moving actions.

Rejected: building full login, SSO, and role-based access control inside the take-home.

Why: full auth would consume time without proving the core billing correctness properties. The MVP still has an actor source for auditability, and every money-moving route rejects missing actor headers.

Trade-off: a shared ops secret does not provide per-user authorization or revocation. Production should replace it with SSO/RBAC and preserve the same actor field in the audit model.

## Threat Model

### Hostile customer

Worst case: a customer reads another customer's usage or invoice data.

Attack: a legitimate customer calls `GET /v1/invoices/:id` with another tenant's invoice ID. UUID guessing is already impractical, but the design does not rely on that. The invoice repository scopes the lookup by both authenticated `customer_id` and requested `invoice_id`; a mismatch returns `404`, revealing neither existence nor owner.

Second attack: a customer submits usage events with a competitor's `api_key_id` to misattribute usage. The ingestion route calls the API key repository to verify every supplied `api_key_id` belongs to the authenticated customer before inserting events.

Remaining risk: a future route could accidentally bypass repository scoping. Mitigation is to keep tenant filtering in repository methods and test cross-tenant access at the route boundary.

### Hostile internal ops user

Worst case: an ops user reduces an invoice to zero by issuing repeated credits.

Attack: an ops user with the shared ops secret calls `POST /ops/customers/:id/credits` repeatedly with different idempotency keys. Each request is valid, and `total_cents` is floored at zero.

What stops silent abuse: every credit writes an audit row with actor, action, reason, before/after totals, entity ID, and timestamp. The ops UI surfaces this trail. The actor is required for money-moving routes, so the mutation is attributable.

What this does not stop: a database superuser or application role with direct `UPDATE` or `DELETE` permission could tamper with audit rows. Production mitigation is a dedicated app DB role with only `INSERT/SELECT` on `audit_logs`, or triggers that reject audit log mutation.

### Compromised webhook source

Worst case: an attacker marks an unpaid invoice as paid.

Replay attack: an attacker captures a valid webhook and resends it. The unique `webhook_deliveries.provider_event_id` constraint makes the second delivery a no-op and prevents `markInvoicePaid` from re-running.

Forgery attack: an attacker crafts a payload for a known invoice ID. The route verifies `X-Payment-Signature` with HMAC-SHA256 against the exact raw body bytes using `PAYMENT_WEBHOOK_SECRET` before parsing JSON or touching the database.

Remaining risk: the MVP does not enforce a webhook timestamp freshness window. If a provider reused event IDs incorrectly or if a valid signed payload leaked, replay policy depends on `provider_event_id`. Production should add a `Webhook-Timestamp` header and reject deliveries older than five minutes.

## Failure Modes at Production Scale

### What breaks first at 5K customers and 200 events/sec sustained

1. Aggregation scans become too slow.

At 200 events/sec, a 48-hour lookback contains about 34.5M events. The current aggregation query filters `usage_events` by `occurred_at`, groups by `customer_id` and hour, and upserts into `usage_windows`. Without time-based partitioning, the table grows continuously and query planning becomes less predictable.

Fix: partition `usage_events` by month, keep indexes local to partitions, shrink the frequent scheduled lookback to two hours, and run a nightly 48-hour reconciliation pass for late events.

2. Invoice generation loads all customer-period usage in one job.

The MVP invoice generation path is designed for a small customer set. At 5K customers it is still acceptable; at 50K+ customers a single all-customer period scan risks a timeout while holding the advisory lock.

Fix: paginate customers, for example 500 at a time, and process batches sequentially. The unique `(customer_id, period_start, period_end)` constraint keeps reruns safe if the job fails midway.

3. Ops customer detail audit lookup degrades with invoice history.

The current `findCustomerDetail` audit query collects logs by customer ID, invoice IDs, and invoice line item IDs. For a customer with many years of invoices, the subquery fan-out grows with invoice and line-item count.

Fix: denormalize `customer_id` onto `audit_logs`, backfill existing rows, and index `(customer_id, created_at DESC)`. That makes customer audit reads a direct indexed query.

4. API-key-filtered usage reads hit raw events.

The MVP uses `usage_events` for `GET /v1/usage?api_key_id=...` because `usage_windows` is only `customer x hour`. This is correct but not the fastest read path when customers have many keys and long date ranges.

Fix: add `usage_windows_by_api_key(customer_id, api_key_id, window_start, total_units)` and route filtered reads to that rollup.

## Observability

Metrics and structured logs to emit:

* `{ job: "aggregateUsage", status, windowsUpserted, durationMs, rangeStart, rangeEnd }`
* `{ job: "generateInvoices", status, invoicesCreated, invoicesSkipped, durationMs, periodStart, periodEnd }`
* `{ event: "usageIngested", accepted, duplicates, customerId, durationMs }`
* `{ event: "webhookReceived", duplicate, signatureValid, invoiceId, providerEventId }`
* `{ event: "opsMutation", action, actor, entityType, entityId, durationMs }`

Alerts:

1. Aggregation has not succeeded in two hours. Usage windows are stale and billing data is lagging.
2. Invoice generation fails for any customer. That customer may not be invoiced.
3. Webhook signature failures spike. This may indicate spoofing or a misconfigured secret.
4. Anomaly hints fire for many customers at once. This is more likely a pricing, ingestion, or aggregation bug than organic usage.
5. A newly paid invoice has `total_cents = 0`. This could be legitimate, but it should be reviewed for credit abuse.
6. Credit issuance volume spikes by actor. This can reveal compromised ops credentials or misuse.

## Intentionally Not Built

The MVP intentionally excludes real Stripe integration, taxes, multi-currency, PDF invoices, email delivery, cloud deployment, Kafka, full login, complex RBAC, and account-level credit balances. These would distract from the billing correctness core.
