import type { AdvisoryLockRunner } from "../db/advisoryLock.js";
import type { UsageWindowAggregationRange, UsageWindowRepository } from "../repositories/usageWindows.js";

export const AGGREGATE_USAGE_LOCK_KEY = 1001;
export const DEFAULT_AGGREGATION_LOOKBACK_HOURS = 48;

export type AggregateUsageDependencies = {
  locks: AdvisoryLockRunner;
  usageWindows: UsageWindowRepository;
};

export type AggregateUsageOptions = {
  now?: Date;
  lookbackHours?: number;
};

export type AggregateUsageResult = {
  status: "succeeded" | "skipped";
  range: UsageWindowAggregationRange;
  windowsUpserted: number;
};

export async function aggregateUsageWindows(
  dependencies: AggregateUsageDependencies,
  options: AggregateUsageOptions = {},
): Promise<AggregateUsageResult> {
  const range = buildAggregationRange(options);
  const result = await dependencies.locks.withLock(AGGREGATE_USAGE_LOCK_KEY, async () => {
    const aggregation = await dependencies.usageWindows.recomputeFromEvents(range);

    return {
      status: "succeeded" as const,
      range,
      windowsUpserted: aggregation.windowsUpserted,
    };
  });

  return (
    result ?? {
      status: "skipped",
      range,
      windowsUpserted: 0,
    }
  );
}

export function buildAggregationRange(options: AggregateUsageOptions = {}): UsageWindowAggregationRange {
  const now = options.now ?? new Date();
  const lookbackHours = options.lookbackHours ?? DEFAULT_AGGREGATION_LOOKBACK_HOURS;
  const end = addHours(floorToHour(now), 1);
  const start = addHours(end, -lookbackHours);

  return { start, end };
}

function floorToHour(date: Date) {
  const floored = new Date(date);
  floored.setUTCMinutes(0, 0, 0);

  return floored;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}
