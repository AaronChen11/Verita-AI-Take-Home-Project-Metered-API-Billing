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
  const jobRunId = await createJobRun(pool);

  try {
    const result = await aggregateUsageWindows(
      {
        locks: new PostgresAdvisoryLockRunner(pool),
        usageWindows: new PostgresUsageWindowRepository(pool),
      },
      {
        lookbackHours: readPositiveIntEnv("AGGREGATE_USAGE_LOOKBACK_HOURS", DEFAULT_AGGREGATION_LOOKBACK_HOURS),
      },
    );

    const meta = {
      rangeStart: result.range.start.toISOString(),
      rangeEnd: result.range.end.toISOString(),
      windowsUpserted: result.windowsUpserted,
    };
    await finishJobRun(pool, jobRunId, result.status, meta);
    console.log(JSON.stringify({ job: "aggregateUsage", status: result.status, ...meta }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await finishJobRun(pool, jobRunId, "failed", { error: message });
    console.error(JSON.stringify({ job: "aggregateUsage", status: "failed", error: message }));
    throw error;
  }
}

async function createJobRun(pool: ReturnType<typeof getPool>) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO job_runs (job_name, status, metadata)
      VALUES ($1, 'started', '{}'::jsonb)
      RETURNING id
    `,
    ["aggregateUsage"],
  );

  return result.rows[0]?.id ?? "";
}

async function finishJobRun(
  pool: ReturnType<typeof getPool>,
  jobRunId: string,
  status: "failed" | "skipped" | "succeeded",
  metadata: Record<string, unknown>,
) {
  await pool.query(
    `
      UPDATE job_runs
      SET status = $2,
          finished_at = now(),
          metadata = $3
      WHERE id = $1
    `,
    [jobRunId, status, JSON.stringify(metadata)],
  );
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
