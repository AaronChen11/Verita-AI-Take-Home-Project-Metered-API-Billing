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
      invoices: [],
      auditLogs: [],
    });
    expect(queries[1]?.text).toContain("now() - interval '30 days'");
    expect(queries[1]?.values).toEqual(["00000000-0000-4000-8000-000000000001"]);
  });
});
