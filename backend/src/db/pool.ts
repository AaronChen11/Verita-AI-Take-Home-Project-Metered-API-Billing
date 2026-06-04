import { Pool, types } from "pg";

import { env } from "../config/env.js";

types.setTypeParser(20, (value) => Number.parseInt(value, 10));

let pool: Pool | undefined;

export function getPool() {
  pool ??= new Pool({
    connectionString: env.DATABASE_URL,
  });

  return pool;
}

export async function closePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = undefined;
}
