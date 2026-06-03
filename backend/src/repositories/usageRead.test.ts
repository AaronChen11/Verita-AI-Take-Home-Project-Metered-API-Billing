import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PostgresUsageReadRepository } from "./usageRead.js";

describe("PostgresUsageReadRepository", () => {
  it("reads customer usage from usage_windows when no api key filter is present", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;
    const repository = new PostgresUsageReadRepository(pool);

    await repository.listBuckets({
      customerId: "customer_1",
      start: new Date("2026-06-01T00:00:00Z"),
      end: new Date("2026-06-02T00:00:00Z"),
      granularity: "day",
      limit: 101,
    });

    expect(queries[0]?.text).toContain("FROM usage_windows");
    expect(queries[0]?.text).toContain("date_trunc('day', window_start)");
    expect(queries[0]?.values).toEqual([
      "customer_1",
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-02T00:00:00Z"),
      101,
    ]);
  });

  it("reads api-key filtered usage from raw usage_events", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;
    const repository = new PostgresUsageReadRepository(pool);

    await repository.listBuckets({
      customerId: "customer_1",
      apiKeyId: "api_key_1",
      start: new Date("2026-06-01T00:00:00Z"),
      end: new Date("2026-06-02T00:00:00Z"),
      granularity: "hour",
      limit: 101,
      cursorStart: new Date("2026-06-01T12:00:00Z"),
    });

    expect(queries[0]?.text).toContain("FROM usage_events");
    expect(queries[0]?.text).toContain("api_key_id = $2");
    expect(queries[0]?.text).toContain("bucket_start > $5");
    expect(queries[0]?.values).toEqual([
      "customer_1",
      "api_key_1",
      new Date("2026-06-01T00:00:00Z"),
      new Date("2026-06-02T00:00:00Z"),
      new Date("2026-06-01T12:00:00Z"),
      101,
    ]);
  });
});
