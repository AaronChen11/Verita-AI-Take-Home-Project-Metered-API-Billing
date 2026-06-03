import type { Pool } from "pg";

export type UsageEventInsert = {
  requestId: string;
  customerId: string;
  apiKeyId: string;
  endpoint: string;
  units: number;
  occurredAt: Date;
};

export type UsageEventRepository = {
  insertMany(events: readonly UsageEventInsert[]): Promise<number>;
};

export class PostgresUsageEventRepository implements UsageEventRepository {
  constructor(private readonly pool: Pool) {}

  async insertMany(events: readonly UsageEventInsert[]) {
    if (events.length === 0) {
      return 0;
    }

    const values: unknown[] = [];
    const rows = events.map((event, index) => {
      const offset = index * 6;
      values.push(event.requestId, event.customerId, event.apiKeyId, event.endpoint, event.units, event.occurredAt);

      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
    });

    const result = await this.pool.query(
      `
        INSERT INTO usage_events (request_id, customer_id, api_key_id, endpoint, units, occurred_at)
        VALUES ${rows.join(", ")}
        ON CONFLICT (request_id) DO NOTHING
        RETURNING request_id
      `,
      values,
    );

    return result.rowCount ?? result.rows.length;
  }
}
