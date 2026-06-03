import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { PostgresUsageWindowRepository } from "./usageWindows.js";

describe("PostgresUsageWindowRepository", () => {
  it("recomputes usage windows from raw events with an idempotent upsert", async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = [];
    const pool = {
      async query(text: string, values?: unknown[]) {
        queries.push({ text, values });
        return { rowCount: 2, rows: [{ id: "window_1" }, { id: "window_2" }] };
      },
    } as unknown as Pool;
    const repository = new PostgresUsageWindowRepository(pool);
    const range = {
      start: new Date("2026-06-03T09:00:00Z"),
      end: new Date("2026-06-03T11:00:00Z"),
    };

    await expect(repository.recomputeFromEvents(range)).resolves.toEqual({ windowsUpserted: 2 });

    expect(queries[0]?.text).toContain("FROM usage_events");
    expect(queries[0]?.text).toContain("ON CONFLICT (customer_id, window_start)");
    expect(queries[0]?.text).toContain("DO UPDATE SET");
    expect(queries[0]?.values).toEqual([range.start, range.end]);
  });
});
