import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PostgresOpsReadRepository } from "./opsReads.js";

describe("PostgresOpsReadRepository", () => {
  it("lists customers with a composite cursor matching the sort order", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new PostgresOpsReadRepository(pool);
    const cursor = {
      createdAt: new Date("2026-06-03T12:00:00Z"),
      id: "00000000-0000-4000-8000-000000000001",
    };

    await repository.listCustomers(51, cursor);

    expect(queries[0]?.text).toContain("AND (customers.created_at, customers.id) < ($2, $3)");
    expect(queries[0]?.text).toContain("ORDER BY customers.created_at DESC, customers.id DESC");
    expect(queries[0]?.values).toEqual([51, cursor.createdAt, cursor.id]);
  });

  it("returns customer detail and computes the anomaly hint", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        if (queries.length === 1) {
          return {
            rows: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                name: "Acme",
                email: "billing@acme.test",
                price_plan_name: "Growth",
                created_at: new Date("2026-06-03T12:00:00Z"),
              },
            ],
          };
        }
        if (queries.length === 2) {
          return { rows: [{ current_hour_units: "1001", average_hourly_units_last_30_days: "100" }] };
        }
        if (queries.length === 3) {
          return {
            rows: [
              {
                id: "00000000-0000-4000-8000-000000000010",
                period_start: "2026-06-01",
                period_end: "2026-07-01",
                status: "issued",
                total_cents: 10_000,
                created_at: new Date("2026-06-03T13:00:00Z"),
                line_items: [
                  {
                    id: "00000000-0000-4000-8000-000000000011",
                    amount_cents: 10_000,
                    description: "Usage",
                    is_overridden: false,
                    unit_price_micros: "1000",
                    units: 100_000,
                  },
                ],
              },
            ],
          };
        }
        if (queries.length === 4) {
          return {
            rows: [
              {
                id: "00000000-0000-4000-8000-000000000020",
                actor: "ops@example.com",
                action: "credit.created",
                entity_type: "invoice",
                entity_id: "00000000-0000-4000-8000-000000000010",
                reason: "Test credit",
                before_value: { totalCents: 10_000 },
                after_value: { totalCents: 9_500 },
                created_at: new Date("2026-06-03T14:00:00Z"),
              },
            ],
          };
        }

        return { rows: [] };
      },
    } as unknown as Pool;
    const repository = new PostgresOpsReadRepository(pool);

    await expect(repository.findCustomerDetail("00000000-0000-4000-8000-000000000001")).resolves.toMatchObject({
      customer: { name: "Acme" },
      usage: {
        currentHourUnits: 1001,
        averageHourlyUnitsLast30Days: 100,
        anomaly: true,
      },
      invoices: [
        {
          lineItems: [
            {
              id: "00000000-0000-4000-8000-000000000011",
              unitPriceMicros: 1000,
              units: 100_000,
            },
          ],
        },
      ],
      auditLogs: [{ beforeValue: { totalCents: 10_000 }, afterValue: { totalCents: 9_500 } }],
    });
    expect(queries[1]?.text).toContain("now() - interval '30 days'");
    expect(queries[1]?.values).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(queries[2]?.text).toContain("jsonb_agg");
    expect(queries[2]?.text).toContain("LEFT JOIN invoice_line_items");
    expect(queries[3]?.text).toContain("FROM invoices");
    expect(queries[3]?.text).toContain("FROM invoice_line_items");
    expect(queries[3]?.text).toContain("audit_logs.before_value");
    expect(queries[3]?.text).toContain("audit_logs.after_value");
    expect(queries[3]?.values).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });
});
