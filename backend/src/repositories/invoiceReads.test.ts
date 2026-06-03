import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PostgresInvoiceRepository } from "./invoices.js";

describe("PostgresInvoiceRepository customer reads", () => {
  it("lists invoices by customer with cursor pagination", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new PostgresInvoiceRepository(pool);
    const cursor = {
      createdAt: new Date("2026-06-03T12:00:00Z"),
      id: "00000000-0000-4000-8000-000000000010",
    };

    await repository.listForCustomer("customer_1", 51, cursor);

    expect(queries[0]?.text).toContain("WHERE customer_id = $1");
    expect(queries[0]?.text).toContain("AND (created_at, id) < ($3, $4)");
    expect(queries[0]?.text).toContain("ORDER BY created_at DESC, id DESC");
    expect(queries[0]?.values).toEqual(["customer_1", 51, cursor.createdAt, cursor.id]);
  });

  it("looks up invoice detail by customer and invoice id", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (queries.length === 1) {
          return {
            rows: [
              {
                id: "invoice_1",
                period_start: "2026-06-01",
                period_end: "2026-07-01",
                status: "draft",
                subtotal_cents: 100,
                credits_cents: 0,
                total_cents: 100,
                issued_at: null,
                paid_at: null,
                created_at: new Date("2026-06-03T12:00:00Z"),
              },
            ],
          };
        }

        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new PostgresInvoiceRepository(pool);

    await expect(repository.findForCustomer("customer_1", "invoice_1")).resolves.toMatchObject({
      id: "invoice_1",
      lineItems: [],
      credits: [],
    });
    expect(queries[0]?.text).toContain("WHERE customer_id = $1");
    expect(queries[0]?.text).toContain("AND id = $2");
    expect(queries[0]?.values).toEqual(["customer_1", "invoice_1"]);
  });
});
