import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closePool, getPool } from "../db/pool.js";
import { PostgresCreditRepository } from "../repositories/credits.js";
import { PostgresOpsReadRepository } from "../repositories/opsReads.js";
import { PostgresUsageEventRepository } from "../repositories/usageEvents.js";
import { PostgresUsageWindowRepository } from "../repositories/usageWindows.js";

const ids = {
  apiKey: randomUUID(),
  customer: randomUUID(),
  invoice: randomUUID(),
  lineItem: randomUUID(),
  plan: randomUUID(),
};

describe("Postgres integration", () => {
  beforeAll(async () => {
    const pool = getPool();
    await pool.query("INSERT INTO price_plans (id, name) VALUES ($1, 'Integration Plan')", [ids.plan]);
    await pool.query(
      `
        INSERT INTO customers (id, name, email, price_plan_id)
        VALUES ($1, 'Integration Customer', 'integration@example.test', $2)
      `,
      [ids.customer, ids.plan],
    );
    await pool.query(
      `
        INSERT INTO api_keys (id, customer_id, key_prefix, key_hash)
        VALUES ($1, $2, 'mb_test_', $3)
      `,
      [ids.apiKey, ids.customer, `hash-${randomUUID()}`],
    );
    await pool.query(
      `
        INSERT INTO invoices (
          id,
          customer_id,
          period_start,
          period_end,
          status,
          subtotal_cents,
          credits_cents,
          total_cents
        )
        VALUES ($1, $2, '2026-06-01', '2026-07-01', 'issued', 2000, 0, 2000)
      `,
      [ids.invoice, ids.customer],
    );
    await pool.query(
      `
        INSERT INTO invoice_line_items (id, invoice_id, description, units, unit_price_micros, amount_cents)
        VALUES ($1, $2, 'Integration usage', 2000, 1000, 2000)
      `,
      [ids.lineItem, ids.invoice],
    );
  });

  afterAll(async () => {
    const pool = getPool();
    await pool.query("DELETE FROM customers WHERE id = $1", [ids.customer]);
    await pool.query("DELETE FROM price_plans WHERE id = $1", [ids.plan]);
    await closePool();
  });

  it("deduplicates usage events with the real request_id constraint", async () => {
    const repository = new PostgresUsageEventRepository(getPool());
    const requestId = `integration-${randomUUID()}`;
    const event = {
      apiKeyId: ids.apiKey,
      customerId: ids.customer,
      endpoint: "/v1/integration",
      occurredAt: new Date("2026-06-03T12:34:00.000Z"),
      requestId,
      units: 7,
    };

    await expect(repository.insertMany([event])).resolves.toBe(1);
    await expect(repository.insertMany([event])).resolves.toBe(0);
  });

  it("recomputes windows and returns jsonb_agg line items from real Postgres", async () => {
    await new PostgresUsageWindowRepository(getPool()).recomputeFromEvents({
      end: new Date("2026-06-03T13:00:00.000Z"),
      start: new Date("2026-06-03T12:00:00.000Z"),
    });

    const detail = await new PostgresOpsReadRepository(getPool()).findCustomerDetail(ids.customer);

    expect(detail?.usage.averageHourlyUnitsLast30Days).toBeGreaterThanOrEqual(7);
    expect(detail?.invoices[0]?.lineItems).toEqual([
      {
        amountCents: 2000,
        description: "Integration usage",
        id: ids.lineItem,
        isOverridden: false,
      },
    ]);
  });

  it("updates invoice totals and audit rows through the real credit transaction", async () => {
    const result = await new PostgresCreditRepository(getPool()).issueCredit({
      actor: "integration-test",
      amountCents: 250,
      customerId: ids.customer,
      idempotencyKey: `integration-credit-${randomUUID()}`,
      invoiceId: ids.invoice,
      reason: "Integration credit",
    });

    expect(result.duplicate).toBe(false);
    expect(result.invoice).toMatchObject({
      creditsCents: 250,
      subtotalCents: 2000,
      totalCents: 1750,
    });

    const detail = await new PostgresOpsReadRepository(getPool()).findCustomerDetail(ids.customer);
    expect(detail?.auditLogs[0]).toMatchObject({
      action: "credit.created",
      actor: "integration-test",
      afterValue: expect.objectContaining({ totalCents: 1750 }),
      beforeValue: expect.objectContaining({ totalCents: 2000 }),
    });
  });
});
