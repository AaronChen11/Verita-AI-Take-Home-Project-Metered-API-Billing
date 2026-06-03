import "dotenv/config";

import { closePool, getPool } from "../db/pool.js";
import { DEMO_API_KEY_ID, DEMO_CUSTOMER_ID } from "./demoIds.js";

type GenerateUsageOptions = {
  customerId: string;
  apiKeyId: string;
  hours: number;
  eventsPerHour: number;
  unitsPerEvent: number;
  endpoint: string;
};

export async function generateUsage(options: GenerateUsageOptions) {
  const pool = getPool();
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);

  const values: unknown[] = [];
  const rows: string[] = [];
  let index = 1;

  for (let hourOffset = options.hours - 1; hourOffset >= 0; hourOffset -= 1) {
    const hour = new Date(now);
    hour.setUTCHours(now.getUTCHours() - hourOffset);

    for (let eventIndex = 0; eventIndex < options.eventsPerHour; eventIndex += 1) {
      const occurredAt = new Date(hour);
      occurredAt.setUTCMinutes(Math.min(eventIndex, 59), 0, 0);
      const requestId = `demo-${options.customerId}-${occurredAt.toISOString()}-${eventIndex}`;

      values.push(requestId, options.customerId, options.apiKeyId, options.endpoint, options.unitsPerEvent, occurredAt);
      rows.push(`($${index}, $${index + 1}, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5})`);
      index += 6;
    }
  }

  if (rows.length === 0) {
    return { inserted: 0 };
  }

  const result = await pool.query(
    `
      INSERT INTO usage_events (
        request_id,
        customer_id,
        api_key_id,
        endpoint,
        units,
        occurred_at
      )
      VALUES ${rows.join(", ")}
      ON CONFLICT (request_id) DO NOTHING
    `,
    values,
  );

  return { inserted: result.rowCount ?? 0 };
}

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
  const result = await generateUsage({
    customerId: process.env.DEMO_CUSTOMER_ID ?? DEMO_CUSTOMER_ID,
    apiKeyId: process.env.DEMO_API_KEY_ID ?? DEMO_API_KEY_ID,
    hours: readPositiveIntEnv("DEMO_USAGE_HOURS", 72),
    eventsPerHour: readPositiveIntEnv("DEMO_USAGE_EVENTS_PER_HOUR", 3),
    unitsPerEvent: readPositiveIntEnv("DEMO_USAGE_UNITS_PER_EVENT", 250),
    endpoint: process.env.DEMO_USAGE_ENDPOINT ?? "/v1/completions",
  });

  console.log(`Inserted ${result.inserted} demo usage events.`);
}

if (process.env.NODE_ENV !== "test" && isDirectScript("generateUsage.ts")) {
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
