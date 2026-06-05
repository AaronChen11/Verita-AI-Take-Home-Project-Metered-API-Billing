import "dotenv/config";

import { PostgresAdvisoryLockRunner } from "../db/advisoryLock.js";
import { closePool, getPool } from "../db/pool.js";
import { generateInvoicesForPeriod } from "../jobs/generateInvoices.js";
import { PostgresInvoiceRepository } from "../repositories/invoices.js";

type JobStatus = "failed" | "skipped" | "succeeded";

async function main() {
  const pool = getPool();
  const period = readBillingPeriod();
  const jobRunId = await createJobRun(pool);

  try {
    const result = await generateInvoicesForPeriod(
      {
        invoices: new PostgresInvoiceRepository(pool),
        locks: new PostgresAdvisoryLockRunner(pool),
      },
      period,
    );

    const meta = {
      invoicesCreated: result.invoicesCreated,
      invoicesSkipped: result.invoicesSkipped,
      periodEnd: result.period.end,
      periodStart: result.period.start,
    };
    await finishJobRun(pool, jobRunId, result.status, meta);
    console.log(JSON.stringify({ job: "generateInvoices", status: result.status, ...meta }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await finishJobRun(pool, jobRunId, "failed", { error: message, periodEnd: period.end, periodStart: period.start });
    console.error(JSON.stringify({ job: "generateInvoices", status: "failed", error: message }));
    throw error;
  }
}

function readBillingPeriod() {
  const start = process.env.INVOICE_PERIOD_START;
  const end = process.env.INVOICE_PERIOD_END;

  if (start || end) {
    if (!start || !end) {
      throw new Error("INVOICE_PERIOD_START and INVOICE_PERIOD_END must be provided together");
    }
    assertDateOnly("INVOICE_PERIOD_START", start);
    assertDateOnly("INVOICE_PERIOD_END", end);
    if (end <= start) {
      throw new Error("INVOICE_PERIOD_END must be after INVOICE_PERIOD_START");
    }
    return { end, start };
  }

  return previousUtcMonthPeriod(new Date());
}

function previousUtcMonthPeriod(now: Date) {
  const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  return {
    end: formatDateOnly(currentMonthStart),
    start: formatDateOnly(previousMonthStart),
  };
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function assertDateOnly(name: string, value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${name} must use YYYY-MM-DD`);
  }
}

async function createJobRun(pool: ReturnType<typeof getPool>) {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO job_runs (job_name, status, metadata)
      VALUES ($1, 'started', '{}'::jsonb)
      RETURNING id
    `,
    ["generateInvoices"],
  );

  return result.rows[0]?.id ?? "";
}

async function finishJobRun(
  pool: ReturnType<typeof getPool>,
  jobRunId: string,
  status: JobStatus,
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

if (process.env.NODE_ENV !== "test" && isDirectScript("generateInvoices.ts")) {
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
