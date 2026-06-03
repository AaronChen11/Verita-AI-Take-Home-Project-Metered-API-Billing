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
