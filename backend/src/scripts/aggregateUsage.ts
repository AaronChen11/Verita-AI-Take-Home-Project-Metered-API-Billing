import "dotenv/config";

import { PostgresAdvisoryLockRunner } from "../db/advisoryLock.js";
import { closePool, getPool } from "../db/pool.js";
import { aggregateUsageWindows, DEFAULT_AGGREGATION_LOOKBACK_HOURS } from "../jobs/aggregateUsage.js";
import { PostgresUsageWindowRepository } from "../repositories/usageWindows.js";

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

async function main() {
  const pool = getPool();
  const result = await aggregateUsageWindows(
    {
      locks: new PostgresAdvisoryLockRunner(pool),
      usageWindows: new PostgresUsageWindowRepository(pool),
    },
    {
      lookbackHours: readPositiveIntEnv("AGGREGATE_USAGE_LOOKBACK_HOURS", DEFAULT_AGGREGATION_LOOKBACK_HOURS),
    },
  );

  console.log(`Usage aggregation ${result.status}.`);
  console.log(`Range: ${result.range.start.toISOString()} - ${result.range.end.toISOString()}`);
  console.log(`Windows upserted: ${result.windowsUpserted}`);
}

if (process.env.NODE_ENV !== "test" && isDirectScript("aggregateUsage.ts")) {
  main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => {
      void closePool();
    });
}

function isDirectScript(scriptName: string) {
  return process.argv[1]?.endsWith(scriptName) ?? false;
}
