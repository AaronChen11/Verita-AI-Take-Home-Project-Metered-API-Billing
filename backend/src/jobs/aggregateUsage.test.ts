import { describe, expect, it } from "vitest";

import {
  AGGREGATE_USAGE_LOCK_KEY,
  aggregateUsageWindows,
  buildAggregationRange,
} from "./aggregateUsage.js";
import type { AdvisoryLockRunner } from "../db/advisoryLock.js";
import type { UsageWindowAggregationRange, UsageWindowRepository } from "../repositories/usageWindows.js";

describe("buildAggregationRange", () => {
  it("builds an hourly lookback range ending after the current hour", () => {
    const range = buildAggregationRange({
      now: new Date("2026-06-03T10:23:45Z"),
      lookbackHours: 24,
    });

    expect(range).toEqual({
      start: new Date("2026-06-02T11:00:00Z"),
      end: new Date("2026-06-03T11:00:00Z"),
    });
  });
});

describe("aggregateUsageWindows", () => {
  it("runs recomputation under the aggregation advisory lock", async () => {
    const calls: Array<{ lockKey?: number; range?: UsageWindowAggregationRange }> = [];
    const locks: AdvisoryLockRunner = {
      async withLock(lockKey, work) {
        calls.push({ lockKey });
        return work();
      },
    };
    const usageWindows: UsageWindowRepository = {
      async recomputeFromEvents(range) {
        calls.push({ range });
        return { windowsUpserted: 3 };
      },
    };

    const result = await aggregateUsageWindows(
      { locks, usageWindows },
      { now: new Date("2026-06-03T10:23:45Z"), lookbackHours: 2 },
    );

    expect(result).toEqual({
      status: "succeeded",
      range: {
        start: new Date("2026-06-03T09:00:00Z"),
        end: new Date("2026-06-03T11:00:00Z"),
      },
      windowsUpserted: 3,
    });
    expect(calls[0]).toEqual({ lockKey: AGGREGATE_USAGE_LOCK_KEY });
    expect(calls[1]).toEqual({
      range: {
        start: new Date("2026-06-03T09:00:00Z"),
        end: new Date("2026-06-03T11:00:00Z"),
      },
    });
  });

  it("skips safely when the advisory lock is already held", async () => {
    const locks: AdvisoryLockRunner = {
      async withLock() {
        return undefined;
      },
    };
    const usageWindows: UsageWindowRepository = {
      async recomputeFromEvents() {
        throw new Error("recompute should not run");
      },
    };

    const result = await aggregateUsageWindows(
      { locks, usageWindows },
      { now: new Date("2026-06-03T10:23:45Z"), lookbackHours: 2 },
    );

    expect(result).toEqual({
      status: "skipped",
      range: {
        start: new Date("2026-06-03T09:00:00Z"),
        end: new Date("2026-06-03T11:00:00Z"),
      },
      windowsUpserted: 0,
    });
  });
});
