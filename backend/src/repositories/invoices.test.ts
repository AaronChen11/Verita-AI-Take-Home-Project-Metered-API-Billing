import { describe, expect, it } from "vitest";
import type { Pool, PoolClient } from "pg";

import { PostgresInvoiceRepository } from "./invoices.js";

type FakeClient = PoolClient & { released: boolean };

describe("PostgresInvoiceRepository", () => {
  it("lists customer usage and price tiers for a billing period", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return {
          rows: [
            {
              customer_id: "customer_1",
              total_units: 120_000,
              tiers: [{ minUnits: 0, maxUnits: null, unitPriceMicros: "1000" }],
            },
          ],
        };
      },
    } as unknown as Pool;
    const repository = new PostgresInvoiceRepository(pool);

    await expect(repository.listCustomerUsageForPeriod({ start: "2026-06-01", end: "2026-07-01" })).resolves.toEqual([
      {
        customerId: "customer_1",
        totalUnits: 120_000,
        tiers: [{ minUnits: 0, maxUnits: null, unitPriceMicros: 1000 }],
      },
    ]);
    expect(queries[0]?.text).toContain("WITH period_usage AS");
    expect(queries[0]?.text).toContain("plan_tiers AS");
    expect(queries[0]?.text).toContain("LEFT JOIN period_usage");
    expect(queries[0]?.values).toEqual(["2026-06-01", "2026-07-01"]);
  });

  it("aggregates usage before joining price tiers to avoid duplicated units", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new PostgresInvoiceRepository(pool);

    await repository.listCustomerUsageForPeriod({ start: "2026-06-01", end: "2026-07-01" });

    const sql = queries[0]?.text ?? "";
    const periodUsagePosition = sql.indexOf("WITH period_usage AS");
    const planTiersPosition = sql.indexOf("plan_tiers AS");
    const customerJoinPosition = sql.indexOf("FROM customers");

    expect(periodUsagePosition).toBeGreaterThanOrEqual(0);
    expect(planTiersPosition).toBeGreaterThan(periodUsagePosition);
    expect(customerJoinPosition).toBeGreaterThan(planTiersPosition);
    expect(sql).not.toContain("SUM(usage_windows.total_units)");
  });

  it("creates invoice and line items transactionally", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [{ rows: [] }, { rows: [{ id: "invoice_1" }] }, { rows: [] }]);
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;
    const repository = new PostgresInvoiceRepository(pool);

    await expect(
      repository.createDraftInvoiceIfNotExists({
        customerId: "customer_1",
        period: { start: "2026-06-01", end: "2026-07-01" },
        subtotalCents: 100,
        lineItems: [
          {
            description: "Usage units 1-above",
            units: 100,
            unitPriceMicros: 10_000,
            amountCents: 100,
          },
        ],
      }),
    ).resolves.toEqual({ created: true, invoiceId: "invoice_1" });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "INSERT", "INSERT", "COMMIT"]);
    expect(client.released).toBe(true);
  });

  it("returns created false when the invoice already exists", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const client = createClient(queries, [{ rows: [] }, { rows: [] }, { rows: [] }]);
    const pool = {
      async connect() {
        return client;
      },
    } as unknown as Pool;
    const repository = new PostgresInvoiceRepository(pool);

    await expect(
      repository.createDraftInvoiceIfNotExists({
        customerId: "customer_1",
        period: { start: "2026-06-01", end: "2026-07-01" },
        subtotalCents: 0,
        lineItems: [],
      }),
    ).resolves.toEqual({ created: false });

    expect(queries.map((query) => query.text.trim().split(/\s+/)[0])).toEqual(["BEGIN", "INSERT", "ROLLBACK"]);
  });
});

function createClient(queries: Array<{ text: string; values?: unknown[] }>, results: Array<{ rows: unknown[] }>) {
  const client = {
    released: false,
    async query(text: string, values?: unknown[]) {
      queries.push({ text, values });
      return results.shift() ?? { rows: [] };
    },
    release() {
      client.released = true;
    },
  } as unknown as FakeClient;

  return client;
}
