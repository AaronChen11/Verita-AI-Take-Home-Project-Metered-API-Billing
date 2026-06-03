import type { Pool, PoolClient } from "pg";

export type AdvisoryLockRunner = {
  withLock<T>(lockKey: number, work: () => Promise<T>): Promise<T | undefined>;
};

export class PostgresAdvisoryLockRunner implements AdvisoryLockRunner {
  constructor(private readonly pool: Pool) {}

  async withLock<T>(lockKey: number, work: () => Promise<T>) {
    const client = await this.pool.connect();

    try {
      const acquired = await tryAcquireAdvisoryLock(client, lockKey);
      if (!acquired) {
        return undefined;
      }

      try {
        return await work();
      } finally {
        await releaseAdvisoryLock(client, lockKey);
      }
    } finally {
      client.release();
    }
  }
}

async function tryAcquireAdvisoryLock(client: PoolClient, lockKey: number) {
  const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [lockKey]);

  return result.rows[0]?.acquired ?? false;
}

async function releaseAdvisoryLock(client: PoolClient, lockKey: number) {
  await client.query("SELECT pg_advisory_unlock($1)", [lockKey]);
}
