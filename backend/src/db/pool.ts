import { Pool } from "pg";

import { env } from "../config/env.js";

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
